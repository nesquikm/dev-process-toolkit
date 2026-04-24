---
title: Shared ResolverConfig Builder (Schema W Loader)
milestone: M15
status: archived
archived_at: 2026-04-22T17:43:51.000Z
tracker:
  linear: STE-44
created_at: 2026-04-22T08:30:00.000Z
---

## Requirement

`resolveFRArgument(arg, config)` is a pure function requiring a `ResolverConfig` shape: `{trackers: [{key, idPattern: RegExp, urlHost, urlPathRegex: RegExp, prefixes?}]}`. `docs/resolver-entry.md:20-23` and the three tracker-aware skills (`/spec-write`, `/implement`, `/spec-archive`) tell skill authors to *"build config from CLAUDE.md `## Task Tracking` + each active adapter's Schema W `resolver:` block"* — but there's no helper to do it. Every caller duplicates the glue. Dogfooded 2026-04-22 — `/implement STE-35` roundtrip required hand-assembly of the config from CLAUDE.md + `adapters/linear.md` frontmatter to even invoke the resolver.

## Acceptance Criteria

- AC-65.1: New module `adapters/_shared/src/resolver_config.ts` exports `buildResolverConfig(claudeMdPath: string, adaptersDir: string): ResolverConfig`
- AC-65.2: Implementation reads `## Task Tracking` section from `CLAUDE.md` via the Schema L probe (reusing `layout.ts` / existing probe code — no new parser)
- AC-65.3: For the primary `mode:` value plus any `secondary_tracker:` key, reads the adapter's `<tracker>.md` frontmatter and extracts the Schema W `resolver:` block (`id_pattern`, `url_host`, `url_path_regex`, optional `prefixes` inferred from `ticket_id_regex`)
- AC-65.4: Compiles regex strings to `RegExp` objects; returns a well-formed `ResolverConfig` ready to hand to `resolveFRArgument`
- AC-65.5: Skills `/spec-write`, `/implement`, `/spec-archive` SKILL.md files instruct: *"call `buildResolverConfig` once at entry, pass the result to `resolveFRArgument`"* — no hand-assembled config anywhere in skill prose
- AC-65.6: Malformed adapter metadata (missing Schema W keys, invalid regex, unreadable file) surfaces via NFR-10 canonical error — never silent fallback to pre-M14 argument handling
- AC-65.7: `mode: none` returns `{ trackers: [] }` (no error, resolver handles empty-trackers fallthrough)
- AC-65.8: Unit tested via `adapters/_shared/src/resolver_config.test.ts` — one case per tracker shape (linear-only, jira-only, linear+jira, mode none, overlapping prefixes, malformed metadata)

## Technical Design

*(pending /implement Phase A)*

## Testing

*(pending /implement Phase A)*

## Notes

Filed 2026-04-22 from `/implement STE-35` dogfooding session. Finding #9 of 10. Closes glue gap between M14's pure resolver and its skill callers.
