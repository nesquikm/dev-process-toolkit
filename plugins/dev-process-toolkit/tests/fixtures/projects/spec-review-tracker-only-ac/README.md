# `spec-review-tracker-only-ac` fixture

Scenario: PM added an AC directly in Linear (e.g., `AC-7.4`), local
`specs/requirements.md` hasn't been re-pulled yet. `/spec-review` in
tracker mode surfaces the tracker-canonical AC list, including the new
`tracker-only` AC, so the review doesn't silently miss it.

In `mode: none` (regression control), `/spec-review` reads only local
`specs/requirements.md` — the extra AC does not surface. Pattern 9 holds.

## Inputs

- **Branch/active_ticket:** `LIN-42` (same as clean-sync fixture).
- **Local `specs/requirements.md` FR-7:**
  ```
  ### FR-7: Audit log export {#FR-7}

  - [ ] AC-7.1: Export entries as CSV
  - [x] AC-7.2: Date-range filter
  - [ ] AC-7.3: Include actor + action
  ```
- **Tracker description (Linear):** same three ACs **plus**:
  ```
  - [ ] AC-7.4: Rate-limit exports per user
  ```

## Expected behavior

**Tracker mode** (`mode: linear`):

1. `/spec-review FR-7` runs Schema L probe → `mode: linear`.
2. Ticket binding (if `--migrate`-style bulk call, iterate matrix); for
   single-FR, resolve FR-7 → `LIN-42` via traceability matrix.
3. `pull_acs(LIN-42)` returns four `AcceptanceCriterion` objects.
4. Traceability map runs against the adapter-returned list:
   ```
   AC-7.1 → src/audit-export.ts:42
   AC-7.2 → src/audit-export.ts:60
   AC-7.3 → (not found)
   AC-7.4 → (not found)    ← tracker-only, surfaced
   ```
5. Report table includes AC-7.4 with status `✗ Missing`, pointing the
   operator at the unimplemented tracker-side requirement.

**`mode: none`** (regression control):

1. Schema L probe → `mode: none`.
2. `/spec-review` reads local `specs/requirements.md` only.
3. AC-7.4 does NOT surface (it doesn't exist locally).
4. Report table shows AC-7.1 / AC-7.2 / AC-7.3 only — byte-identical to
   pre-M12 behavior (Pattern 9).

## Fail conditions

- Tracker-mode run misses AC-7.4 (means the skill is reading
  `specs/requirements.md` instead of calling `pull_acs`).
- `mode: none` run surfaces AC-7.4 (means Pattern 9 is broken — the
  tracker-mode branch is leaking into the none path).
