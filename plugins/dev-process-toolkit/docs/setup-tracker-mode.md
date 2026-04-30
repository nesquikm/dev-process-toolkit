# `/setup` Tracker Mode Flow

This companion doc carries the detailed procedures that `/setup` uses when
the user opts into a tracker mode (Linear / Jira / custom). It is
pointed at from `skills/setup/SKILL.md` to keep that file under NFR-1
(≤300 lines) while still giving operators enough detail to audit the flow.

Applies to `mode: linear | jira | custom` only. `mode: none` (the
default) never reads this document — the `mode: none` branch runs unchanged.

## Core contract (read first)

- **Opt-in question near end of flow.** The question ships just before
  spec-file generation (step 8 in `skills/setup/SKILL.md`). Default is
  `none`; skipping or pressing Enter keeps `mode: none`.
- **Recording.** A recorded mode adds a `## Task Tracking` section to
  `CLAUDE.md` per Schema L (technical-spec §7.3). Absence ≡ `none`
 — `/setup` never writes a `mode: none` line.
- **Never silent writes.** Every `settings.json` and `CLAUDE.md` edit is
  preview + explicit confirm (DD-12.9).
- **Bun prerequisite.** `bun --version` runs before any tracker recording
; absence is an NFR-10 canonical-shape error.
- **Test call on completion.** After MCP detection / install /
  confirmation, `/setup` runs a harmless live call (Linear
  `list_teams`, Jira `search` no-criteria). On failure, surface NFR-10
  canonical shape and refuse to record mode.
- **Per-tenant discovery.** Jira AC custom-field. Records
  `jira_ac_field` in `## Task Tracking`.

## Task map (Phase C)

| Task | Section in this doc |
|------|---------------------|
| C.1 — Mode question (default `none`, skippable) | The tracker-mode question |
| C.2 — Bun install check, hard-stop | Bun prerequisite check |
| C.3 — MCP detection via `claude mcp list` + dry-run settings.json diff | MCP detection |
| C.4 — settings.json confirm + write on approval | MCP detection |
| C.5 — Test-call verification, hard-stop on fail | Test-call verification |
| C.6 — Jira custom-field discovery (one-time) | Per-tenant discovery / Jira |

## The tracker-mode question

Ask exactly once, near the end of `/setup` (after CLAUDE.md is drafted but
before it's written):

> ```
> Task Tracking (optional): where do ACs live?
>   1. none (default — ACs stay in specs/requirements.md)
>   2. linear
>   3. jira
>   4. custom (copy adapters/_template)
>
> [1-4, default 1]:
> ```

If the user picks `1` or skips, do NOT add `## Task Tracking` to CLAUDE.md.
Continue the existing fresh-setup flow. If the user picks 2–4,
proceed through the remaining tracker-mode steps in order.

## Bun prerequisite check

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

## MCP detection

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
`mode: none` remains in effect.

## Test-call verification

After detection / install / confirmation, run exactly one harmless call:

| Tracker | Test call |
|---------|-----------|
| Linear  | `mcp__linear__list_teams` |
| Jira    | `mcp__atlassian__search` with empty criteria |

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

### Jira

**Pre-flight: Space (project) visibility.** Before any other Jira call,
`/setup` for `mode: jira` requires the operator to have **created the
Jira Space (project) in the Jira UI manually** — the Atlassian Rovo MCP
exposes no project-creation tool, so the toolkit cannot do this for them.
After the operator supplies the project key (`### Jira`.project), run
`mcp__atlassian__getVisibleJiraProjects` and assert the configured key
appears in the response. On miss, refuse with NFR-10 canonical shape and
**do not record mode**:

```
Jira project '<key>' not visible to the authenticated principal.
Remedy: create the Space in the Jira UI before running /setup, or grant the OAuth principal membership; then re-run /setup.
Context: mode=jira, project=<key>, skill=setup
```

After visibility passes, run one-time AC-field discovery:

1. Invoke the Atlassian MCP to fetch `GET /rest/api/3/field` (equivalent
   tool, e.g., `mcp__atlassian__list_fields`).
2. Pipe the response array into
   `bun run ${CLAUDE_PLUGIN_ROOT}/adapters/jira/src/discover_field.ts` with
   `{"fields": <response>}` on stdin.
3. On `{ok: true, gid: "customfield_XXXXX"}`, append
   `jira_ac_field: customfield_XXXXX` to the `## Task Tracking` section.
4. On `{ok: false}` — common on team-managed Kanban templates that ship
   without an AC custom field — prompt the operator to choose between two
   recorded outcomes (no silent fallback):

   ```
   No "Acceptance Criteria" custom field found in this Jira project.
     1. I'll create a custom field in Jira and re-run /setup
        → records `jira_ac_field: customfield_XXXXX` after re-run discovers it.
     2. Use the issue description body instead
        → records `jira_ac_field: description`.
        ACs live as a bullet list under a `## Acceptance Criteria` heading
        inside each issue's description; pull_acs / push_ac_toggle parse
        and rewrite that section atomically.

   [1-2]:
   ```

   On `1`, abort the tracker-mode portion cleanly so the operator can
   create the field and re-run `/setup`. On `2`, append
   `jira_ac_field: description` to `## Task Tracking` and continue.

The recorded value is the dispatch key for `pull_acs` / `push_ac_toggle`
(see `adapters/jira.md` § Operations).

## Writing `## Task Tracking` to CLAUDE.md

On successful completion of all the above, append this section to the
bottom of CLAUDE.md (Schema L):

```markdown
## Task Tracking

mode: <linear | jira | custom>
mcp_server: <server name from `claude mcp list`>
jira_ac_field: <customfield_XXXXX | description | blank>
branch_template: <default-for-mode or user value>
```

`jira_ac_field:` accepts three forms (only `mode: jira` projects use it
non-blank):

- `customfield_XXXXX` — per-tenant AC custom-field GID (recorded by
  `discover_field.ts` on `{ ok: true }`).
- `description` — sentinel; ACs live in the issue description body
  under a `## Acceptance Criteria` heading (recorded when the operator
  picks option `2` on the `{ ok: false }` prompt).
- blank — `mode: linear` / `mode: custom` / `mode: none` (key reserved
  for future trackers; ignored when blank).

Blank values for keys that don't apply to the picked mode are legal (Schema L).
`git log` is the audit trail for sync, mode-switch, and resolution events — no
separate subsection is maintained.

## Branch template (`/setup` step 7c)

Immediately after Schema L is authored (or after step 7b in `mode: none`),
prompt once:

> Branch-naming template? (default: `<default-for-mode>`)

**Defaults by mode**

| Mode | Default template |
|------|------------------|
| `none` | `{type}/m{N}-{slug}` |
| `linear` / `jira` / custom | `{type}/{ticket-id}-{slug}` |

**Placeholders (substituted by `/implement` at prompt-time)**

- `{type}` — LLM-inferred `feat` / `fix` / `chore` (unknown values clamp to `feat`).
- `{N}` — milestone number for milestone runs (e.g. `19` for `M19`).
- `{ticket-id}` — tracker ID in tracker mode (e.g. `<TKR>-NN`, lowercased); short-ULID tail (chars 23–29, lowercased) in `mode: none`.
- `{slug}` — LLM-inferred 2–4 word kebab. `[a-z0-9-]` only after sanitization.

**Response handling**

- Empty ⇒ accept default.
- Non-empty ⇒ use verbatim. Skill sanitizes LLM output at render time, so templates need not be shell-safe.
- Rendered branch name > 60 chars ⇒ slug truncated (template prefix preserved).

**Skip conditions**

- `mode: none` projects that elected `1. none` in step 7b: skip writing `branch_template:`. Branch automation stays disabled. Users can opt in later by re-running `/setup` or by hand-adding the key to CLAUDE.md.
- Any project whose CLAUDE.md already has `branch_template:` under `## Task Tracking`: do not re-ask. `/setup --migrate` preserves existing keys by default.

**Consumer scope.** Only `/implement` reads `branch_template:`. Other skills (`/tdd`, `/debug`, `/spec-write`, `/gate-check`, `/pr`, `/spec-archive`, `/spec-review`, `/visual-check`, `/simplify`, `/brainstorm`) continue to run on whatever branch they're invoked from.

## `/setup --migrate` entry

When invoked as `/setup --migrate`, skip steps 1–7 (project detection,
scaffolding, template write) and route directly into tracker-mode
switching — see `skills/setup/SKILL.md` § 0b for the inline
procedure covering current-mode detection and target-mode prompt. The
single commit that lands the mode flip is the audit trail; if the switch
fails partway, rerun `/setup --migrate` from a clean working tree.
