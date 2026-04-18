# `asana-url-paste` fixture

Scenario: user on a branch whose name carries no Asana gid, pastes the full
task URL at the Tier 3 prompt. Verifies AC-32.5 end-to-end: the URL regex
extracts the numeric gid, then ticket binding proceeds with the mandatory
confirmation (AC-32.1).

## Inputs

- **Branch:** `feat/audit-log-export` — no numeric suffix, no bracket tag.
- **CLAUDE.md `## Task Tracking`:**
  ```
  mode: asana
  mcp_server: asana
  active_ticket:
  asana_status_convention: section
  ```
  (`active_ticket:` deliberately blank — Tier 2 misses.)
- **User response at the Tier 3 prompt:**
  `https://app.asana.com/0/1199999999999999/1209876543210`

## Expected behavior

1. `/implement` runs Schema L probe → `mode: asana`.
2. Ticket-binding resolver: Tier 1 misses (branch has no gid), Tier 2
   misses (active_ticket blank), Tier 3 prompt fires with the Asana URL
   variant from `docs/ticket-binding.md`.
3. User pastes the URL. Regex
   `https?://app\.asana\.com/0/\d+/(\d+)` captures gid `1209876543210`.
4. Mandatory confirmation prompt appears:
   `Operating on ticket 1209876543210: <title from pull_acs> — proceed? [y/N]`
5. On `y`, `/implement` proceeds with the resolved gid.

## Fail conditions

- Regex extracts nothing (user pastes a non-URL or non-Asana URL) → prompt
  re-fires with the same wording; no state mutation.
- User declines confirmation → skill exits cleanly (AC-32.4).

## Related tests

- `adapters/asana/src/html_to_md.test.ts` — description round-trip
- Tier 5 manual conformance in `docs/tracker-adapters.md` — live check
