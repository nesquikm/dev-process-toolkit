---
milestone: M_d1b4b7
status: archived
archived_at: 2026-11-06T22:24:08Z
kickoff_branch: null
frozen_at: null
migration: none
codename: Hindsight
shipped_in: v3.2.0
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

- [x] Rewrite the two superseded requirements.md § 5 lines with struck wording and dated notes, and narrow the fast-track line
  verify: the out-of-scope test passes; covers STE-718 ACs 1 to 5
- [x] Amend M_7bc805's Out of Scope test so its remainder excludes the three STE-718 lines, and append the AC-STE-716.13 clause to the archived STE-716
  verify: m_7bc805-ste-716-out-of-scope green with only its exclusion edited and an `Amended by AC-STE-718.8` comment; the archived STE-716 FR differs from its M_7bc805 merge bytes only by the clause; covers STE-718 AC 8
- [x] Calibrate the four thresholds against M_7bc805's captured fixtures before any test freezes them; write the values into the STE-719 Requirement table, which AC-STE-719.4 pins, and their source into its Notes
  verify: each trip fixture sits on the first tripping value and each clear fixture on the last clear one; covers STE-719 ACs 4 and 7
- [x] Build session_aliases.ts, retro_rules.ts, retro_report.ts, retro_scope.ts and the retro.ts front door
  verify: fixture triples per rule; skip reasons name tracking.tool_calls and tracking.gate_outcomes when off; one report written for every setting value; covers STE-719 ACs 2, 5, 6 and 8 to 12
- [x] Add retro to the settings loader's closed sets (`TOP_KEYS`, `settingsKeyOrder`, `NEW_KEYS`, defaults, `retroSwitchOn`), settings-reference and the M_94e6f7 key-mapping table
  verify: unknown retro key throws; the AC-STE-706.12 walk maps `retro` and the planted-knob control still names only `orchestration.skip_gates`; covers STE-719 AC 3
- [x] Ship skills/retro/SKILL.md and move every 28/19 count to 29/20, plus the adoption and allowlist pins
  verify: count tests green; public_surface_count_drift, skill_unreachable and probe #81 clean; covers STE-719 ACs 1 and 13 to 15
- [x] Add the `--redact-identifiers` flag, scrub_identifiers.ts on the shared aliaser and the report_issue_payload.ts front door; call it, only under either flag, after the unchanged secret scrub
  verify: no flag means no front-door call and a byte-identical payload with seven rows; each flag finds no home path, project-folder slug, UUID or branch name and writes ten rows; every front-door mention names a flag; no `report_issue` settings key exists, and archived AC-STE-706.12 carries only its appended Amended-by clause; covers STE-720 ACs 1 to 10, 13, 14 and 15
- [x] Add --from-retro, the prompt defaults, the fourth payload file, the alias seed step and the brainstorm fetch line
  verify: refusal cases, unchanged prompt order, seeded aliases match with the switch off; without the flag the shipped text and payload equal v3.0.0; covers STE-721 ACs 1 to 9, 12 and 13
- [x] Print `retro: on` as a trailing switch line of `gate_capture.ts` and `deliver_decision.ts`, before any `upgrade_offer: on` line; add retro_offer.ts and the two registry entries at the /implement and /deliver close-outs
  verify: both calls byte-identical with retro off, upgrade switch on or off; `upgrade_offer: on` stays last with both on; `upgrade_offer.ts` untouched; empty stdout when off or nothing tripped, with no scope read when off; every retro_offer.ts mention names `retro: on`; probe #85 clean; one question per /deliver run; the archived AC-STE-712.14 carries only its appended Amended-by clause; covers STE-722 ACs 1 to 9, 13, 14, 15 and 16
- [x] Add retro_proposal.ts with its closed table, propose and apply verbs, and the /retro approval gate
  verify: silent when nothing applies; propose writes nothing; the digest covers the realpath of the root, and apply needs a fresh digest and a transcript-verified answer after a real propose, whose question carries every printed line, not only the digest line; apply writes its one `retro-apply` receipt before any other write and a recorded receipt, apply call or consumption line consumes the approval; checks register preconditions with the setting taken as on before any write, adds the shown ignore line, and registers capture for the tool_calls row; a declined, marker-only, prose-only or echoed run leaves settings byte-identical; rollback covers the local settings file; covers STE-728 ACs 1 to 12, 15 and 16
- [x] Grade the approval as a live lone `apply` call sees its transcript: no own line, the propose result and answer required, a recorded earlier `apply` result consuming the approval
  verify: a child-process `apply` writes with no own line in the transcript, refuses after a consumed approval, and a temp copy re-adding the own-line step refuses the live shape; covers STE-728 AC 17
- [x] Add the milestone's defaults-unchanged test
  verify: gate_capture.ts, deliver_decision.ts, upgrade CLI, offers and close-outs equal their v3.0.0 literals; modelled close-outs make no retro_offer.ts call; covers STE-722 AC 12
- [x] Mutation controls for each FR
  verify: removing each named rule or check reds a named test; covers STE-718 AC 6, STE-719 AC 16, STE-720 AC 11, STE-721 AC 10, STE-722 AC 10 and STE-728 AC 13
- [x] Full suite after each FR
  verify: 0 fail and baseline skip identities; covers STE-718 AC 7, STE-719 AC 17, STE-720 AC 12, STE-721 AC 11, STE-722 AC 11 and STE-728 AC 14
- [x] Full suite by name vs trunk before commit; every red caused by this milestone's own edits is either replaced by this milestone's tests or amended with an `Amended by AC-STE-<N>.<M>` marker naming it; list each in the archived FR notes. Zero unexplained reds.
  verify: the JUnit test names of `bun test` from `plugins/dev-process-toolkit` on the milestone's last commit, compared with the same run on trunk under the same bun, show no red outside that list; each listed test names its marker; the pins this plan already names are in the list; covers STE-718 AC 7, STE-719 AC 17, STE-720 AC 12, STE-721 AC 11, STE-722 AC 11 and STE-728 AC 14

### SKILL.md line budget

1. The cap is 358, never raised. Counts are `split("\n").length`, the unit `tests/skill-nfr-1-length.test.ts` measures (`wc -l` reads one fewer), at v3.0.0 (6c62b32c) plus the M_7bc805 rows, which touch none of these files.
2. `skills/implement/SKILL.md` is at the cap (358 split-lines). These tests pin that count exactly:
   - `tests/ticket-ownership-shared.test.ts:766-768` (also 41 `STE-<n>` tokens);
   - `tests/m_79b1f6-ste-590-offers-ask-the-gate.test.ts:498-499` and `tests/m_685ff6-ste-609-prose.test.ts:376-377`;
   - `tests/m_8f07e0-ste-584-awaiting-siblings.test.ts` and `tests/m_79b1f6-ste-592-epic-mint-prose.test.ts`;
   - `tests/m143-ste-553-one-review-instruction.test.ts:322` (`BASELINE_LINES = 358`);
   - `tests/m_94e6f7-ste-710-settings-writers.test.ts:1275` (357, counted as split-lines minus one);
   - the `tests/m143-ste-550-inline-no-terminal-block.test.ts` net-zero baseline.
   The appended retro text carries no `STE-<n>` token, so the 41-token pin holds too.
3. `skills/deliver/SKILL.md` measures 266 split-lines, pinned exactly by `tests/m_8f07e0-ste-582-target-repo-refusal.test.ts:78` (`DELIVER_SKILL_LINE_COUNT = 266`, asserted at :429) and `tests/m_8f07e0-ste-584-awaiting-siblings.test.ts:586`.
   - Both already carry `Amended by AC-STE-712.7`. The deliver row below moves both to 268, each gaining `// Amended by AC-STE-722.9 (266 -> 268)`.
   - The deliver close-out section is the file's last section (line 263 on), so no line-position pin sits after the insertion.
   - The cap is not raised (AC-STE-712.9 awaits the operator).

| SKILL.md | Start | Lines this milestone adds or rewrites | Net | End |
|---|---|---|---|---|
| implement | 358 | In place: the retro offer's sentences are appended to line 297, the Phase 4 Close paragraph that already carries the upgrade offer, after its omission clause and before the ship-ready heading (STE-722). No line is added, so no line is displaced and none of the exact-count pins above moves. Fallback, only if review rejects the in-place append: add the offer as its own paragraph (+2) and displace lines 328 and 329 (the `Full skip-case table` pointer and its blank) by folding that pointer into line 307; the exact-count pins then still read 358, and every test pinning a line position between 298 and 329 is listed and amended with an `Amended by AC-STE-722.8` comment. | 0 | 358 |
| deliver | 266 | Added: the retro offer paragraph and its blank line inside the close-out section, after the upgrade offer (STE-722), +2. The two exact 266 pins above move to 268. | +2 | 268 |
| spec-write | 358 | The report-issue row of § 7 is extended in place (STE-721), adding no `STE-<n>` token, so the 358-line and 54-token pins (`tests/ticket-ownership-shared.test.ts:772`, `tests/m_685ff6-ste-610-template.test.ts:247`, `tests/create-front-door-shared.test.ts:1433`, `tests/m_685ff6-ste-608-spec-write-prose.test.ts:124`, `tests/m_685ff6-ste-611-prose.test.ts:88`, `tests/m_840a06-ste-578-tracker-orphan-consent.test.ts:94`) hold with no edit. | 0 | 358 |
| report-issue | 206 | Added: the front-door paragraph and its blank at the end of § 6 (STE-720), +2; the --from-retro paragraph and its blank at the end of § 1, the `retro.json` file bullet and the `report_issue_retro_seeded` capability bullet (STE-721), +4. Argument-hint, § 6 file-count sentence, § 8 gist line and § 9 rationale rewritten in place. One exact pin: `tests/m_a85e46-ste-656-docs-drift.test.ts:67-72` compares the split-line count with the file at `BASE_SHA` 1d7df0d8 (206); its new report-issue `LINE_DELTA` reads 2 after STE-720 and 6 after STE-721, each with its Amended-by comment, and its `STE-<n>` token assertion is unedited (the added text carries no token). | +6 | 212 |
| brainstorm | 141 | Added: the retro.json fetch line (STE-721), +1. No test pins its count exactly. | +1 | 142 |
| retro (new) | 0 | The new skill with the propose step and its approval gate (STE-719, STE-728); overflow in docs/retro-reference.md. | new | ≤358 |

4. Pins that are not line counts, found by a full-suite run on scratch copies carrying these edits and the registry growth (spec review 6), each named with its amendment in its FR:
   - `tests/m_94e6f7-ste-708-mode-front-door.test.ts` zero-extra-calls rows for implement and deliver: `CONDITIONAL_TARGETS` gains `retro_offer.ts` beside `retro: on`, and archived AC-STE-708.13 gains its second appended clause (AC-STE-722.16).
   - The offer registry pins of `tests/m143-ste-551-continuation-offers.test.ts` (`ALL_OFFER_IDS`, `SHIPPED_ANCHORS`, `CHAIN_REACHED_IDS`, length, per-skill lists and counts, full-chain operator turns) and of `tests/m_94e6f7-ste-712-upgrade-offer.test.ts` (:346 and :350-354) (AC-STE-722.9).
   - `MODULE_BASENAMES` of `tests/m117-ste-428-report-issue-renderable.test.ts` gains `report_issue_payload` (AC-STE-720.15) and `report_issue_retro` (AC-STE-721.13).
   - `GATE_REGISTRY` gains both retro offers as mechanical gates; `EXPECTED_NEW_GATE_IDS` of `tests/m143-ste-552-chain-gate-registration.test.ts` and `POST_FR_ADDED_IDS` of `tests/m133-ste-515-gate-registration.test.ts` move with it, and `ADMITTED_MARKER` of `tests/m_79b1f6-ste-590-offers-ask-the-gate.test.ts` admits `722\.9` for the deliver 268 hunk (AC-STE-722.9).
   - The argument-hint pins (AC-STE-721.1); `report_issue_retro_seeded` is registered in the `/spec-write` § 7 map only, so the six `CANONICAL_CAPABILITY_KEYS` length pins stay at 47 (AC-STE-721.8, AC-STE-721.13).
   - A test M_7bc805 ships (review 7, R7-3): the § 5 remainder of `tests/m_7bc805-ste-716-out-of-scope.test.ts` excludes the three STE-718 lines, and archived AC-STE-716.13 gains its clause (AC-STE-718.8).
   - Two pins review 7 found (m7-2): `BASELINE_LINES` of `tests/m143-ste-550-inline-no-terminal-block.test.ts` (:551) must name exactly `ADOPTING_STAGES`, so it gains a `retro` key; and in `tests/m137-ste-533-stage-block-adoption.test.ts`, beside the 12 to 13 pin AC-STE-719.13 names, the closed-list literal ("operator-resolved eleven, in order"), "all ELEVEN … accepted" and "nine of eleven outside /deliver's vocabulary" rows move with it (AC-STE-719.13).
5. No FR here edits the gate-check SKILL.md.

### Gate

- `bun test` from `plugins/dev-process-toolkit`: 0 fail, skip identities equal to the baseline
- `/gate-check` clean, including probes #57, #81 and #85 and the closing-summary capability-key probe
- Defaults unchanged: with no settings file, and with a migrated file holding only the moved keys, skill, hook and probe outputs equal v3.0.0, the M_94e6f7 merge commit (tests/m_d1b4b7-defaults-unchanged.test.ts); a default close-out and a flagless /report-issue make no extra tool call; no setting changes without a transcript-verified approval. One named difference, on a CLI no skill calls by default: `project_settings.ts get retro` exits 0 with its `enabled: false` default where v3.0.0 refused, and the `get` refusal's section list gains `retro` (AC-STE-722.12)
- implement, deliver, spec-write and the new retro skill each at most 358 lines; implement stays at exactly 358 split-lines

<!-- token-stats:begin -->

## Token Stats

| scope | model | input | output | cache-read | cache-creation |
| --- | --- | ---: | ---: | ---: | ---: |
| dev-process-toolkit:ship-milestone | claude-opus-5-5 | 24 | 4737 | 2498300 | 44720 |
| design/exploration | <synthetic> | 0 | 0 | 0 | 0 |
| design/exploration | claude-opus-5-5 | 2396 | 757654 | 527147591 | 5584275 |
| total |  | 2420 | 762391 | 529645891 | 5628995 |

<!-- token-stats:end -->
