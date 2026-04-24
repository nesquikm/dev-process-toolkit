---
id: fr_01KPT3RPQRXXAAK97S9GHK6Z4W
title: Fix /setup --migrate Detection for mode:none→tracker Path
milestone: M15
status: archived
archived_at: 2026-04-22T17:43:51.000Z
tracker:
  linear: STE-35
created_at: 2026-04-22T08:00:00.000Z
---

## Requirement

`/setup --migrate` currently detects tracker-mode migration only when `CLAUDE.md` has a `## Task Tracking` section (per `skills/setup/SKILL.md:33`). This excludes the `mode: none → <tracker>` path, even though `docs/setup-migrate.md:8-11` explicitly supports it and the AC-36.2 procedure reads "no section → mode is none" as a valid current state. Dogfooded on 2026-04-22 against the plugin's own repo — the skill's detection rule fell through, and migration only proceeded because Claude applied doc intent.

## Acceptance Criteria

- AC-56.1: Skill detection rule in `skills/setup/SKILL.md:33` treats absence of `## Task Tracking` (i.e., `mode: none` canonical form per AC-29.5) as a valid starting state for tracker-mode migration when `--migrate` is in arguments
- AC-56.2: Running `/setup --migrate` on a `mode: none` project routes into the tracker-mode migration branch (proceeds to target-mode prompt), not fresh-setup
- AC-56.3: A regression fixture `mode-none-v2-migration/` exercises a v2-layout + mode: none + `/setup --migrate` invocation, asserting the target-mode prompt appears (not the fresh-setup flow)
- AC-56.4: Existing fresh-setup routing is unchanged when `--migrate` flag is absent (backward compat): `/setup` without flags on a mode: none project still runs the fresh-setup flow (step 7b tracker-mode question)
- AC-56.5: The NFR-10 refusal at the top of migration handling names exactly which transition would run (e.g., `"Detected current mode: none. Supported targets: linear, jira, custom."`) — no silent fall-through to other branches

## Technical Design

*(pending /implement Phase A)*

## Testing

*(pending /implement Phase A)*

## Notes

Filed 2026-04-22 from `/setup --migrate` dogfooding session on the plugin's own repo. Finding #1 of 8.
