---
title: Delete Linear V1 SSE migration code + docs (D1)
milestone: M26
status: archived
archived_at: 2026-04-25T07:10:08Z
tracker:
  linear: STE-93
created_at: 2026-04-25T06:42:06Z
---

## Requirement

The Linear V1 SSE endpoint (`https://mcp.linear.app/sse`) was deprecated in favor of `/mcp` and announced for shutdown 2026-05-11. M22 (STE-77) swept most V1 references but left residue:

- `skills/setup/SKILL.md:157` — "User decline is fine — they can skip migration and still proceed on V1 until the 2026-05-11 shutdown." Only remaining `2026-05-11` reference in repo.
- `docs/setup-tracker-mode.md:23-24, 39, 81-85` — `## Linear SSE retirement migration (AC-STE-9.9)` section documenting a dry-run V1→V2 migration path.
- `docs/tracker-adapters.md:271` — "The `https://mcp.linear.app/sse` endpoint is retired."
- `adapters/linear.md:108` — same language.
- Any V1-detection + dry-run migration code in `/setup`'s migration flow.

`.mcp.json` already points at the V2 endpoint (verified iteration 1). With no external installs, the residual migration plumbing serves no purpose — its only consumer would be a fresh user who somehow got a `.mcp.json` pointing at the V1 endpoint, which the plugin no longer ships.

## Acceptance Criteria

- AC-STE-93.1: `skills/setup/SKILL.md` no longer references `2026-05-11` or "V1 SSE" or "SSE retirement migration"; `grep -n "2026-05-11\|SSE retirement\|sse" skills/setup/SKILL.md` returns no matches. {#AC-STE-93.1}
- AC-STE-93.2: `docs/setup-tracker-mode.md` `## Linear SSE retirement migration` section (including AC-STE-9.9 references) is deleted in entirety. The remainder of the doc is reflowed for continuity. {#AC-STE-93.2}
- AC-STE-93.3: `docs/tracker-adapters.md:271` SSE-retired sentence removed; surrounding paragraph reflows naturally. {#AC-STE-93.3}
- AC-STE-93.4: `adapters/linear.md:108` SSE-retired sentence removed. {#AC-STE-93.4}
- AC-STE-93.5: Any V1-endpoint detection / dry-run migration code in `/setup` runtime is removed. `grep -rn "mcp\.linear\.app/sse" plugins/dev-process-toolkit/` returns no matches in code (CHANGELOG entries documenting prior work are exempt — historical records). {#AC-STE-93.5}
- AC-STE-93.6: `bun test` remains green; no missing-import errors after deletions. {#AC-STE-93.6}

## Technical Design

Pure deletion. No replacement code; no compat shim. If a future user somehow ends up with V1 in `.mcp.json`, they get an unhelpful tool-list error rather than a guided migration — acceptable given no users exist.

Order of operations:
1. Remove code references first (`/setup` runtime).
2. Remove doc references (`adapters/linear.md`, `docs/tracker-adapters.md`, `docs/setup-tracker-mode.md`).
3. Remove `setup/SKILL.md:157` last (single-line orphan after upstream deletion).

Per-step `bun test` to catch any unexpected dependency.

## Testing

No new tests. Delete any test that exclusively covers V1 SSE detection/migration (likely none — most `/setup` tests are mode-switching, not SSE-version-aware). Verify `tests/setup-*.test.ts` does not assert SSE-retirement copy.

## Notes

CHANGELOG entries for v1.22.0 and earlier reference SSE retirement as historical work — these are not modified (they describe what was true at the time). Origin: PR #4 audit D1.
