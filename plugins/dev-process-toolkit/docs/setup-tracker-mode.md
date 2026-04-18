# `/setup` Tracker Mode Flow

This companion doc carries the detailed procedures that `/setup` uses when
the user opts into a tracker mode (Linear / Jira / Asana / custom). It is
pointed at from `skills/setup/SKILL.md` to keep that file under NFR-1
(≤300 lines) while still giving operators enough detail to audit the flow.

Applies to `mode: linear | jira | asana | custom` only. `mode: none` (the
default) never reads this document — the pre-M12 path runs unchanged.

## Core contract (read first)

- **Opt-in question near end of flow.** The question ships just before
  spec-file generation (step 8 in `skills/setup/SKILL.md`). Default is
  `none`; skipping or pressing Enter keeps `mode: none`.
- **Recording.** A recorded mode adds a `## Task Tracking` section to
  `CLAUDE.md` per Schema L (technical-spec §7.3). Absence ≡ `none`
  (AC-29.5) — `/setup` never writes a `mode: none` line.
- **Never silent writes.** Every `settings.json` and `CLAUDE.md` edit is
  preview + explicit confirm (AC-30.3, DD-12.9).
- **Bun prerequisite.** `bun --version` runs before any tracker recording
  (AC-30.8); absence is an NFR-10 canonical-shape error.
- **Linear V1 SSE migration.** If Linear MCP is configured at
  `https://mcp.linear.app/sse`, `/setup` offers a dry-run migration to
  `https://mcp.linear.app/mcp` (AC-30.9).
- **Test call on completion.** After MCP detection / install /
  confirmation, `/setup` runs a harmless live call (Linear
  `list_teams`, Jira `search` no-criteria, Asana `list_workspaces`). On
  failure, surface NFR-10 canonical shape and refuse to record mode
  (AC-30.4, AC-30.5).
- **Per-tenant discovery.** Jira AC custom-field (AC-30.6); Asana status
  convention (AC-30.7). Records `jira_ac_field` or
  `asana_status_convention` in `## Task Tracking`.

## Task map (Phase C traceability)

| Task | Section in this doc | AC refs |
|------|---------------------|---------|
| C.1 — Mode question (default `none`, skippable) | The tracker-mode question | AC-29.1, AC-29.2, AC-29.5 |
| C.2 — Bun install check, hard-stop | Bun prerequisite check | AC-30.8, NFR-10 |
| C.3 — Linear V1 SSE → V2 migration dry-run | Linear V1 SSE migration | AC-30.9 |
| C.4 — MCP detection via `claude mcp list` + dry-run settings.json diff | MCP detection | AC-30.1, AC-30.2 |
| C.5 — settings.json confirm + write on approval | MCP detection | AC-30.3, DD-12.9 |
| C.6 — Test-call verification, hard-stop on fail | Test-call verification | AC-30.4, AC-30.5, NFR-10 |
| C.7 — Jira custom-field discovery (one-time) | Per-tenant discovery / Jira | AC-30.6 |
| C.8 — Asana status-convention discovery | Per-tenant discovery / Asana | AC-30.7 |

## The tracker-mode question

Ask exactly once, near the end of `/setup` (after CLAUDE.md is drafted but
before it's written):

> ```
> Task Tracking (optional): where do ACs live?
>   1. none (default — ACs stay in specs/requirements.md)
>   2. linear
>   3. jira
>   4. asana
>   5. custom (copy adapters/_template)
>
> [1-5, default 1]:
> ```

If the user picks `1` or skips, do NOT add `## Task Tracking` to CLAUDE.md
(AC-29.5). Continue the existing fresh-setup flow. If the user picks 2–5,
proceed through the remaining tracker-mode steps in order.

## Bun prerequisite check (AC-30.8)

Before any MCP work, verify:

```bash
bun --version
```

If `bun` isn't on PATH or the version is < 1.2, surface this canonical-shape
error and **do not record mode**:

```
Bun runtime not found (required for tracker mode).
Remedy: install Bun ≥ 1.2 (macOS: brew install bun; Linux: curl -fsSL https://bun.sh/install | bash; Windows: powershell -c "irm bun.sh/install.ps1 | iex") and re-run /setup.
Context: mode=<picked>, ticket=unbound, skill=setup
```

## Linear V1 SSE migration (AC-30.9)

If the user picks `linear`, inspect `claude mcp list` output before doing
anything else. If it contains the exact substring `https://mcp.linear.app/sse`,
warn and offer migration:

```
Linear MCP is on the deprecated V1 SSE endpoint (shutdown 2026-05-11).
Migrate now? This will show a dry-run settings.json diff; nothing is written
without confirmation. [y/N]:
```

On `y`, render the exact JSON diff: delete the `sse` URL, add the V2
`https://mcp.linear.app/mcp` entry with Streamable-HTTP transport. Do not
write until the user confirms the rendered diff (AC-30.3).

## MCP detection (AC-30.1, AC-30.2)

Shell out to `claude mcp list` to enumerate currently configured MCP servers
across enterprise / user / project / local scopes (DD-12.8). If the adapter
for the picked tracker has a matching `mcp_server:` entry in its
`<tracker>.md` frontmatter, the MCP is present.

If the MCP is **absent**, print the exact JSON diff that would be added to
`settings.json` (dry-run preview), then prompt for confirmation:

```
settings.json would gain this entry (nothing has been written yet):

  "mcpServers": {
    "linear": {
      "url": "https://mcp.linear.app/mcp",
      "transport": "streamable-http"
    }
  }

Apply? [y/N]:
```

On `n`, abort the tracker-mode portion cleanly; leave all files untouched.
`mode: none` remains in effect (AC-30.3).

## Test-call verification (AC-30.4, AC-30.5)

After detection / install / confirmation, run exactly one harmless call:

| Tracker | Test call |
|---------|-----------|
| Linear  | `mcp__linear__list_teams` |
| Jira    | `mcp__atlassian__search` with empty criteria |
| Asana   | `mcp__asana__list_workspaces` |

If the call fails (network error, unauthorized, timeout), surface this
canonical-shape error and refuse to record mode:

```
Tracker MCP test call failed for <tracker>.
Remedy: <actionable — e.g., "complete OAuth in the MCP UI, then re-run /setup">
Context: mode=<picked>, ticket=unbound, skill=setup
```

Only on test-call success does `/setup` write the `## Task Tracking`
section to CLAUDE.md.

## Per-tenant discovery

### Jira (AC-30.6)

After test-call success, run one-time AC custom-field discovery:

1. Invoke the Atlassian MCP to fetch `GET /rest/api/3/field` (equivalent
   tool, e.g., `mcp__atlassian__list_fields`).
2. Pipe the response array into
   `bun run adapters/jira/src/discover_field.ts` with
   `{"fields": <response>}` on stdin.
3. On `{ok: true, gid: "customfield_XXXXX"}`, append
   `jira_ac_field: customfield_XXXXX` to the `## Task Tracking` section.
4. On `{ok: false}`, prompt the user to create an "Acceptance Criteria"
   custom field in Jira and re-run `/setup`.

### Asana (AC-30.7)

Detect the workspace's status convention:

1. Fetch the workspace's custom fields via
   `mcp__asana__list_custom_fields` (or equivalent).
2. If any field has `type: "enum"` and name matches `/status|state/i`,
   record `asana_status_convention: custom_enum`.
3. Else, if the project has sections matching `/backlog|in progress|in review|done/i`,
   record `asana_status_convention: section`.
4. Otherwise, fall back to `asana_status_convention: completed_boolean`.

## Writing `## Task Tracking` to CLAUDE.md

On successful completion of all the above, append this section to the
bottom of CLAUDE.md (Schema L):

```markdown
## Task Tracking

mode: <linear | jira | asana | custom>
mcp_server: <server name from `claude mcp list`>
active_ticket:
jira_ac_field: <customfield_XXXXX or blank>
asana_status_convention: <section | custom_enum | completed_boolean or blank>

### Sync log
```

Blank values for keys that don't apply to the picked mode are legal (Schema L).
The `### Sync log` subsection is created empty; `/implement`, `/spec-write`,
and `/gate-check` append audit entries per AC-39.8.

## `/setup --migrate` entry

When invoked as `/setup --migrate`, skip steps 1–7 (project detection,
scaffolding, template write) and route directly into FR-36 migration
handling — see `docs/setup-migrate.md`.
