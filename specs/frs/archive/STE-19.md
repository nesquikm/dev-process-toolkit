---
id: fr_01KPR3M74XA75GJKT4Z4HG95T3
title: Tracker ID as Frontmatter Attribute
milestone: M12
status: archived
archived_at: 2026-04-23T05:56:49Z
tracker:
  linear: STE-19
created_at: 2026-04-21T13:28:11.653Z
---

## Requirement

Tracker IDs are zero-to-many frontmatter attributes under `tracker:`. They are never the canonical ID; they never participate in filenames. Multiple trackers are supported on a single FR (e.g., Linear for product work + GitHub Issues for linked infra work).

## Acceptance Criteria

- AC-STE-19.1: Frontmatter accepts an optional `tracker:` map; keys are tracker names (`linear`, `jira`, `github`, plus any custom adapter name), values are ticket IDs (string) or null
- AC-STE-19.2: Zero tracker entries is valid (tracker-less mode or a not-yet-synced FR in tracker mode)
- AC-STE-19.3: `Provider.sync()` may add, update, or clear individual tracker entries; it MUST NOT modify `id`, `title`, `milestone`, or filename
- AC-STE-19.4: Multiple tracker entries on one FR are valid and supported — `Provider.getUrl(id, trackerKey)` returns the URL for the requested key, or null
- AC-STE-19.5: An FR's tracker entries are written in a stable key order (alphabetical) to keep diffs minimal

## Technical Design

*(not present in v1; fill in post-migration)*

## Testing

*(not present in v1; fill in post-migration)*

## Notes

Migrated from v1 by `/setup --migrate` on 2026-04-21.
