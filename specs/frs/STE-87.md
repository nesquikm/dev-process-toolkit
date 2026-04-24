---
title: /gate-check active-side ticket-state drift probe + /implement tracker-write routing rule
milestone: M24
status: active
archived_at: null
tracker:
  linear: STE-87
created_at: 2026-04-24T13:42:00Z
---

## Requirement

M23 closed two paper cuts from the M20 dogfood, but the M23 `/implement` run itself surfaced a third: Phase 1 step 0.c `Provider.claimLock` was skipped entirely in the session, and when the user flagged it, the mid-session patch (`mcp__linear__save_issue`) transitioned the ticket via a direct MCP call — sliding around STE-65's `Backlog → Done` silent-leap guardrail. Both failures went undetected by deterministic checks; only the user's manual observation caught them.

A third related gap surfaced during STE-87's own `/spec-write` session: the agent narrated a specific unallocated tracker ID in conversation before the allocator returned it. STE-66 prescribes `<tracker-id>` placeholders in drafts but is prose-only; nothing on disk would catch an FR file authored with a guessed ID that doesn't match the allocator's return.

The root gaps:

- STE-54's archive-side ticket-state-drift probe (`/gate-check` probe #8) has no active-side counterpart.
- `/implement`'s Phase 4 Close prose says "call `Provider.releaseLock`" but doesn't forbid the direct-MCP bypass that skips STE-65's precondition guard.
- STE-66's tracker-ID placeholder rule has no deterministic file-level enforcement.

M24 closes all three gaps with one FR, mirroring STE-54 symmetrically + adding a sibling probe for guessed-ID detection:

1. **`/gate-check` probe #14 — active-side ticket-state drift.** Walks `specs/frs/*.md` (non-archive) where `status: active` and a bound tracker ref exists. Calls `Provider.getTicketStatus(<tracker-ref>)`. Asserts the returned `status` matches the adapter's `status_mapping.in_progress` AND the assignee matches `currentUser`. Mismatch → **GATE FAILED** naming the FR + tracker ref + observed vs. expected status + observed vs. expected assignee. Skipped for `mode: none` (`LocalProvider.getTicketStatus` returns the `local-no-tracker` sentinel, same carve-out as probe #8 per AC-STE-54.5).

2. **`/implement` tracker-write routing rule.** Adds one line under `## Rules`: tracker-write operations on in-flight FRs (`transition_status`, `save_issue` state changes, equivalent adapter-write ops) must route through `Provider.claimLock` / `Provider.releaseLock` — never direct MCP tool invocation. Reads (`get_issue` for display) remain permitted. STE-65's precondition check only fires when the Provider path is taken; the rule ensures that path IS taken.

3. **`/gate-check` probe #15 — guessed-tracker-ID scan.** For each `specs/frs/*.md` (active, non-archive) with a bound tracker, every `AC-<PREFIX>.<N>` line's `<PREFIX>` must equal the file's own `tracker.<key>` value. Mismatch → **GATE FAILED** naming the file, the prefix used, and the expected tracker ID. Skipped for `mode: none` (short-ULID prefix instead — scanned separately by the existing ac_prefix probe suite).

4. **`/brainstorm` + `/spec-write` `## Rules` prose.** Each gets one new rule line forbidding narration of a specific unallocated tracker ID in conversation — mitigation for the conversational-leak hazard that probes can't catch (LLM speech, not file content).

The gate-check probes are the deterministic enforcer (catch drift regardless of cause); the prose rules are prompt-time warnings for human-facing narration.

## Acceptance Criteria

- AC-STE-87.1: `skills/gate-check/SKILL.md` § "v2 Conformance Probes" adds a new probe #14 "Ticket-state drift — active side" that mirrors probe #8's shape: walks every `specs/frs/*.md` (excluding `archive/**`) with `status: active` AND a non-null `tracker.<key>` binding; resolves `Provider` once (same rule as `/implement` / probe #8); calls `Provider.getTicketStatus(<tracker-ref>)`; asserts `status == status_mapping.in_progress` AND `assignee == currentUser`. Mismatch → **GATE FAILED** reporting a row with the FR's **ULID** + **tracker ID** + **observed status** vs. **expected** `in_progress` + **observed assignee** vs. **expected** `currentUser`. Skipped for `mode: none` — `LocalProvider.getTicketStatus` returns `local-no-tracker` sentinel; nothing to compare.
- AC-STE-87.2: Probe #14 tolerates the STE-28 `already-ours` shape — a ticket at `in_progress` with `currentUser` as assignee passes, regardless of whether the current session called `claimLock` or a prior session did. The probe is over observed tracker state, not over call-history.
- AC-STE-87.3: `skills/implement/SKILL.md` `## Rules` section adds exactly one new rule line: "Do NOT call raw `mcp__<tracker>__save_issue` / `mcp__<tracker>__transition_status` / equivalent **write** operations for in-flight FRs during an `/implement` session. Route through `Provider.claimLock` / `Provider.releaseLock`. Read operations (`mcp__<tracker>__get_issue` for display) are fine. Rationale: STE-65's guardrail only fires on the Provider path; direct MCP writes bypass it."
- AC-STE-87.4: New test file `tests/gate-check-active-ticket-drift.test.ts` mirrors `tests/gate-check-ticket-state-drift.test.ts` shape. Cases: (a) positive — active FR with bound tracker at in_progress + matching assignee passes; (b) negative — Backlog fails with GATE FAILED naming observed `backlog` vs. expected `in_progress`; (c) negative — Done fails; (d) negative — wrong assignee fails; (e) `mode: none` skip returns early; (f) prose-shape assertion — SKILL.md contains probe #14 heading substring.
- AC-STE-87.5: Existing `/gate-check` probe #8 (ticket-state drift — archive side) continues to pass byte-identically. STE-54's tests still green.
- AC-STE-87.6: Existing `skills/implement/SKILL.md` Phase 4 Close step (b) prose (which mentions `Provider.releaseLock`) continues to pass `tests/implement-phase4-releaselock.test.ts` + `tests/implement-phase4-close.test.ts` byte-identically. The new `## Rules` line is additive.
- AC-STE-87.7: Probes #14 and #15 are listed in `skills/gate-check/SKILL.md` § "Probe authoring contract" as required to ship with their own test files (STE-82). The test file `gate-check-active-ticket-drift.test.ts` fulfils the contract for #14; `gate-check-guessed-tracker-id.test.ts` fulfils it for #15.
- AC-STE-87.8: `skills/gate-check/SKILL.md` § "v2 Conformance Probes" adds a new probe #15 "Guessed tracker-ID scan". For each `specs/frs/*.md` (active, non-archive) with a bound `tracker.<key>`, parse every `AC-<PREFIX>.<N>` line (shape from STE-50's `acPrefix`). Every `<PREFIX>` must equal the file's own `tracker.<key>` value. Mismatch → **GATE FAILED** naming the file, the offending prefix, and the expected tracker ID. NFR-10 remedy: "AC prefix does not match the file's bound tracker — did you draft with a guessed ID? Substitute via STE-66's `<tracker-id>` convention and re-save." Skipped for `mode: none` — short-ULID prefixes are scanned by the existing `ac_prefix` duplicate-scan suite (STE-50 AC-STE-50.5). New test file `tests/gate-check-guessed-tracker-id.test.ts` covers: (a) positive match, (b) prefix-vs-tracker mismatch fails, (c) `mode: none` skip, (d) FR with no bound tracker skipped (no frontmatter.tracker key), (e) prose-shape assertion.
- AC-STE-87.9: `skills/brainstorm/SKILL.md` `## Rules` adds one line: "Do NOT narrate a specific unallocated tracker ID (e.g., `STE-87`) in conversation when drafting — use the literal placeholder `<tracker-id>` (or the adapter rendering: `STE-<N>` for Linear, `PROJ-<N>` for Jira) until the tracker allocator returns the real ID. STE-66 covers draft files; this rule covers the conversational hazard that file-level probes cannot catch."
- AC-STE-87.10: `skills/spec-write/SKILL.md` `## Rules` adds the same line as AC-STE-87.9, verbatim.

## Technical Design

**`skills/gate-check/SKILL.md` edits** (~25 new lines): add probes #14 and #15 after probe #12 in the numbered list.

**`skills/implement/SKILL.md` edits** (1 new line in `## Rules`): the tracker-write-routing rule.

**`skills/brainstorm/SKILL.md` + `skills/spec-write/SKILL.md` edits** (1 new line each in `## Rules`): the conversational-leak rule.

**New test files** `tests/gate-check-active-ticket-drift.test.ts` (~80 lines) and `tests/gate-check-guessed-tracker-id.test.ts` (~60 lines). Both mirror `tests/gate-check-ticket-state-drift.test.ts` shape. Use stubbed `AdapterDriver` where applicable.

**No runtime code changes.** Probe #14 reuses existing `Provider.getTicketStatus`. Probe #15 is pure filesystem + frontmatter + regex scan — no tracker calls, no new shared code.

## Testing

See AC-STE-87.4 and AC-STE-87.8 for the test breakdown. All assertions behavioral + prose-shape, following the existing `/gate-check` probe-authoring pattern (STE-82). No fixture directory changes — in-file driver stubs for #14; fixture FR files inline for #15.

Existing regression coverage preserved: `gate-check-ticket-state-drift.test.ts`, `implement-phase4-close.test.ts`, `implement-phase4-releaselock.test.ts`, `spec-write-placeholder-convention.test.ts` all continue passing byte-identically (AC-STE-87.5 / AC-STE-87.6 invariants).

## Notes

**Why mirror STE-54 exactly instead of inventing a new enforcement mechanism.** STE-54 established the pattern: read-side probe in `/gate-check` catches drift regardless of cause. The "right" completion of that pattern is the symmetric active-side probe — which didn't ship in STE-54's scope because the invariant "archived tickets → Done" was the only failure mode surfaced at the M15 dogfood. M23's self-hosted run surfaced the other half: "active tickets → In-Progress with self-assignee." Adding probe #14 completes STE-54's half-finished pair, using exactly the same shape, same test convention (STE-82), same `mode: none` carve-out (`local-no-tracker`), and same NFR-10 remedy format.

**Why bundle probe #15 + the brainstorm/spec-write prose with STE-87.** Both extensions are STE-66 prose-rule-to-deterministic-probe upgrades, same family as the STE-54 extension driving STE-87.1–7. Keeping them in one FR preserves M24's single-FR shape and lets one test-file authoring pass cover the full enforcement surface. If the scope grows beyond two probes in the future, split into a sibling FR then.

**Why skill-local prose rules instead of a new NFR.** The tracker-write-routing invariant is workflow-specific to `/implement`; the conversational-leak rule is specific to `/brainstorm` + `/spec-write`. Existing NFRs describe *shape* invariants (canonical error form, filename permanence, call-budget discipline), not *workflow* invariants. The rules live next to STE-65's `claimLock`/`releaseLock` guardrails in `## Rules` for the same reason.

**Conversational-leak residual.** A probe can only scan committed state; it cannot police what the LLM types in chat. The `## Rules` lines are the mitigation, but they remain a soft rule — if the LLM narrates a guessed ID and then correctly uses `<tracker-id>` in the file, probe #15 sees nothing wrong. Accept as residual; humans catch it in review (as happened in this FR's own drafting session).

**Release target:** v1.25.0. Phase A of M24 plan.
