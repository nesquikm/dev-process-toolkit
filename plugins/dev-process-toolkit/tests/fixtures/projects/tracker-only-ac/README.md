# `tracker-only-ac` fixture

Scenario: PM added `AC-7.4: Rate-limit exports per user` directly in the
Linear UI. Local `specs/requirements.md` FR-7 still lists only AC-7.1..7.3.
FR-39 classifies AC-7.4 as `tracker-only`; user resolves; local requirements
file gains AC-7.4.

## Inputs

- Local FR-7 (same as `clean-sync`): AC-7.1, AC-7.2, AC-7.3.
- Tracker description (Linear): AC-7.1, AC-7.2, AC-7.3, **AC-7.4**.

## Expected behavior

1. `/implement` pre-flight runs FR-39.
2. Schema K diff:
   ```
   AC-7.1: identical  | local: "..." | tracker: "..."
   AC-7.2: identical  | local: "..." | tracker: "..."
   AC-7.3: identical  | local: "..." | tracker: "..."
   AC-7.4: tracker-only | local: "<absent>" | tracker: "Rate-limit exports per user"
   ```
3. Only AC-7.4 prompts:
   ```
   Resolve: (1) keep local  (2) keep tracker  (3) merge  (4) cancel
   ```
4. User picks `(2) keep tracker` → local `specs/requirements.md` FR-7
   gains AC-7.4 bullet.
5. Sync log appends: `- 2026-04-18T10:00:00Z — 1 AC conflicts resolved on LIN-42`
   (with `DPT_TEST_FROZEN_TIME=2026-04-18T10:00:00Z`).
6. `/implement` proceeds past pre-flight with the four-AC list.

## Fail conditions

- AC-7.4 classified as anything other than `tracker-only`.
- Sync log entry missing or malformed.
- No local requirements.md write after `keep tracker`.
