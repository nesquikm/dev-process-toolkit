# `edited-both` fixture

Scenario: local `specs/requirements.md` and the tracker ticket both changed
AC-7.1 in between sessions — different text on each side. FR-39 classifies
the AC as `edited-both`; user picks `(3) merge` and writes the merged form;
both sides converge on the merged text.

## Inputs

- Local FR-7 AC-7.1: `AC-7.1: Export entries as CSV (UTF-8 encoded)`
- Tracker AC-7.1: `AC-7.1: Export audit entries as a downloadable CSV`
- AC-7.2..AC-7.3 identical on both sides.

## Expected behavior

1. `/implement` pre-flight runs FR-39.
2. Schema K diff:
   ```
   AC-7.1: edited-both | local: "Export entries as CSV (UTF-8 encoded)" | tracker: "Export audit entries as a downloadable CSV"
   AC-7.2: identical   | ...
   AC-7.3: identical   | ...
   ```
3. AC-7.1 prompts. User picks `(3) merge`. Editor heredoc shows both
   versions as commented context; user writes:
   `AC-7.1: Export audit entries as a downloadable CSV (UTF-8 encoded)`
4. Merged text applied to both sides:
   - Local: `specs/requirements.md` FR-7 AC-7.1 rewritten.
   - Tracker: `upsert_ticket_metadata(LIN-42, ...)` rewrites description
     with the new canonical AC block.
5. `git log` captures the resolution commit; no separate audit trail is written (STE-58).
6. A second `pull_acs` (e.g., on next `/implement`) classifies everything
   as `identical` — convergence in one round (AC-39.6).

## Cancel variant

If the user types `(4) cancel` instead of merging:

1. `specs/requirements.md` unchanged.
2. No `upsert_ticket_metadata` call.
3. No commit (nothing to record — skill cancelled cleanly).
4. Skill exits cleanly (AC-39.5).

## Fail conditions

- AC-7.1 classified anything other than `edited-both`.
- Merge applied to only one side (local OR tracker).
- Cancel causes any file write on either side.
