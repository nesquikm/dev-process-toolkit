---
id: fr_01KPR3M74WN5NYPM4D2PSQ8CQM
title: Adapter Pattern (Declarative Metadata + Code Driver)
milestone: M12
status: archived
archived_at: 2026-04-23T05:56:49Z
tracker:
  linear: STE-10
created_at: 2026-04-21T13:28:11.653Z
---

## Requirement

Each supported tracker is implemented as a paired adapter: a declarative `<tracker>.md` describing conventions and capabilities, plus a code driver implementing a fixed 4-operation interface. The 4 operations (`pull_acs`, `push_ac_toggle`, `transition_status`, `upsert_ticket_metadata`) cover the full lifecycle of FR mirroring + AC checkbox state + status transitions, enabling the plugin to keep tracker tickets current with local spec edits.

## Acceptance Criteria

- AC-STE-10.1: `plugins/dev-process-toolkit/adapters/` directory exists in the plugin
- AC-STE-10.2: Each adapter ships a `<tracker>.md` declarative metadata file with frontmatter fields: `name`, `mcp_server`, `ticket_id_regex`, `ticket_id_source`, `ac_storage_convention`, `status_mapping`, `capabilities`, `ticket_description_template`, `helpers_dir` (see Schema M in technical-spec §7.3 for field definitions)
- AC-STE-10.3: The 4-op contract — `pull_acs(ticket_id)`, `push_ac_toggle(ticket_id, ac_id, state)`, `transition_status(ticket_id, status)`, `upsert_ticket_metadata(ticket_id_or_null, title, description) → ticket_id` — is declared per adapter in `<tracker>.md` frontmatter + `docs/tracker-adapters.md` and dispatched by the LLM via MCP tools at skill runtime. The plugin does not own the MCP transport; MCP is only callable from the Claude Code harness, so a Bun-level dispatcher would have to shell out to `claude` — architecturally worse than model-native dispatch. Each adapter MAY ship pure TypeScript helpers under `adapters/<tracker>/src/` for the text-wrangling portions of its ops (e.g., `linear/src/normalize.ts` canonicalizes Linear's description section; `jira/src/discover_field.ts` discovers the Jira custom-field GID). Helpers are invoked via `bun run` with JSON on stdin. No compiled binaries are shipped; no `dist/` directory exists. Runtime verification: (i) each adapter helper has Bun unit tests, (ii) skill probes confirm adapter metadata is read before any MCP call, (iii) Tier 5 manual-conformance checklist exercises each op end-to-end against live MCP
- AC-STE-10.4: Skills that need tracker operations load the active adapter based on CLAUDE.md's `mode:` field and call only the 4-op interface — never tracker-specific code directly
- AC-STE-10.5: `_template.md` + template driver ship in `adapters/` for `custom` mode, with inline documentation
- AC-STE-10.6: `upsert_ticket_metadata(ticket_id=null, ...)` creates a new tracker ticket and returns its ID; called with a non-null `ticket_id`, it updates the existing ticket's title and description (not ACs, not status — those have dedicated ops)

## Technical Design

*(not present in v1; fill in post-migration)*

## Testing

*(not present in v1; fill in post-migration)*

## Notes

Migrated from v1 by `/setup --migrate` on 2026-04-21.
