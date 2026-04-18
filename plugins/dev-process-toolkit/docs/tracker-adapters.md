# Tracker Adapters

How the plugin talks to Linear, Jira, Asana, and any custom tracker without
hard-coding tracker-specific logic anywhere in the skills.

Applies to v1.15.0+ (M12, "Tracker Integration"). In `mode: none` (default),
everything on this page is unused — skills run their pre-M12 body unchanged.

## Bun runtime prerequisite

Tracker mode requires **Bun ≥ 1.2** on the user's machine. The plugin ships
adapter helpers as TypeScript source (`adapters/<tracker>/src/*.ts`); there
are no compiled binaries and no `dist/` directory (DD-12.5, NFR-7). Helpers
are invoked as `bun run adapters/<tracker>/src/<helper>.ts`.

Install guidance:

- **macOS:** `brew install bun`
- **Linux:** `curl -fsSL https://bun.sh/install | bash`
- **Windows:** `powershell -c "irm bun.sh/install.ps1 | iex"`

`/setup` verifies Bun with `bun --version` when the user picks a tracker
mode (AC-30.8). If Bun is absent, `/setup` surfaces an NFR-10 canonical-shape
error with install guidance and **does not record `mode: <tracker>`** — the
project remains in `mode: none` until Bun is available.

## Skills' view of a tracker

Every mode-aware skill — `/setup`, `/spec-write`, `/implement`, `/gate-check`,
`/pr`, `/spec-review`, `/spec-archive` — runs the Schema L tracker-mode probe
first (see `docs/patterns.md` § Tracker Mode Probe). Absence of
`## Task Tracking` in `CLAUDE.md` means `mode: none` and the pre-M12 path
runs unchanged. When a tracker is active, skills resolve the **active
adapter** by reading `<mode>:` from `## Task Tracking` and loading the
matching `adapters/<mode>.md`.

Skills then invoke exactly one of four operations — never tracker-specific
code directly:

| Operation | Signature | Purpose |
|-----------|-----------|---------|
| `pull_acs` | `(ticket_id) → AcList` | Fetch current AC state (Schema N). |
| `push_ac_toggle` | `(ticket_id, ac_id, state: bool) → void` | Toggle a single AC checkbox. |
| `transition_status` | `(ticket_id, status) → void` | Move ticket to canonical status (`in_progress` / `in_review` / `done`). |
| `upsert_ticket_metadata` | `(ticket_id_or_null, title, description) → ticket_id` | Create (null id) or update ticket title + description. Never touches ACs or status — dedicated ops own those. |

Adapters are markdown (`adapters/<tracker>.md`) plus optional TypeScript
helpers (`adapters/<tracker>/src/*.ts`). The markdown routes each op to the
right MCP tool; helpers handle tracker-specific text massaging (Linear
normalization, Jira field discovery, Asana HTML ↔ Markdown).

## Schemas (technical-spec §7.3)

Full definitions live in `specs/technical-spec.md` §7.3. Summary:

- **Schema L — `## Task Tracking` section format.** Cross-skill. Heading
  presence is the mode probe; absence ≡ `mode: none`. Keys: `mode`,
  `mcp_server`, `active_ticket`, `jira_ac_field`, `asana_status_convention`.
  Duplicate keys are a malformed file and fail the skill with NFR-10
  canonical shape.
- **Schema M — Adapter frontmatter.** Nine fields: `name`, `mcp_server`,
  `ticket_id_regex`, `ticket_id_source`, `ac_storage_convention`,
  `status_mapping`, `capabilities`, `ticket_description_template`,
  `helpers_dir`. Capabilities drive FR-38 AC-38.6 graceful degradation.
- **Schema N — `AcceptanceCriterion` list.** Returned by `pull_acs`. Fields:
  `id`, `text`, `completed`.
- **Schema O — `TicketMetadata`.** Internal; tracked for concurrency via
  `updated_at` (AC-33.2, AC-33.3).
- **Schema P — Helper script I/O contract.** JSON on stdin → JSON on
  stdout, errors on stderr + non-zero exit, no network, deterministic pure
  functions.

## Authoring a custom adapter

1. Copy `adapters/_template.md` to `adapters/<your-tracker>.md`.
2. Copy `adapters/_template/src/` to `adapters/<your-tracker>/src/`.
3. Fill in Schema M frontmatter:
   - `name` matches the `mode:` value users will pick.
   - `mcp_server` matches the exact string from `claude mcp list`.
   - `ticket_id_regex` captures the numeric/ID portion of a branch name.
   - `capabilities` lists only what your adapter supports. Omit any op you
     can't implement — `/gate-check` and `/pr` degrade gracefully with an
     NFR-10 canonical-shape warning (FR-38 AC-38.6).
4. Author the four operation sections in your markdown. Each section names
   the MCP tool and notes any tracker-specific quirks (normalization,
   field discovery, HTML rendering).
5. Add helper sources under `adapters/<your-tracker>/src/` for anything
   that needs pure-function text transforms. Ship `*.test.ts` next to each
   helper so `bun test` can run them (testing-spec §6.3).
6. Run the Conformance Checklist below against a real tracker account.
   Contributed adapters must include a passed checklist in their PR (Tier 5,
   manual).

## Conformance Checklist

Each shipped adapter (Linear, Jira, Asana, custom) must pass this checklist
against a real tracker instance before release. No automated harness in v1
(test accounts + OAuth + teardown are too heavy); pass markers are recorded
in the adapter's PR description.

### Prerequisites

- [ ] Bun ≥ 1.2 installed: `bun --version`
- [ ] Tracker MCP reachable: `claude mcp list` shows the server as `✓ Connected`
- [ ] Test ticket created in the tracker with 3+ ACs (2 checked, 1 unchecked)

### `pull_acs`

- [ ] Returns Schema N list (objects with `id`, `text`, `completed`)
- [ ] Non-AC content (comments, description preamble, attachments) discarded at
      parser boundary (FR-35)
- [ ] Empty-AC ticket fails the skill with `"No acceptance criteria found in
      ticket <ID>"` in NFR-10 canonical shape (AC-35.4)
- [ ] Normalization round-trips: `normalize(normalize(x)) === normalize(x)`
      holds for Linear; equivalent invariant for Jira / Asana

### `push_ac_toggle`

- [ ] Toggling a single AC in the tracker updates only that checkbox (other
      ACs unchanged, no description rewrites beyond the minimal diff)
- [ ] Linear: semantic markdown diff used, not string diff — no Linear
      server-side normalization loop (AC-37.5)
- [ ] If adapter does not declare `push_ac_toggle` in capabilities, skills
      degrade with an NFR-10 canonical-shape reminder (FR-38 AC-38.6)

### `transition_status`

- [ ] Moves the ticket to the status resolved via `status_mapping`
- [ ] Unknown status values fail with an NFR-10 canonical-shape error
- [ ] If adapter does not declare `transition_status` in capabilities, `/pr`
      skips the call with a canonical-shape warning and continues

### `upsert_ticket_metadata`

- [ ] Creating a ticket (null id) returns a stable ticket ID
- [ ] Updating an existing ticket rewrites title + description only (no
      status change, no AC toggle — those have dedicated ops)
- [ ] Description body contains the full FR body **and** a visible back-link
      to `specs/requirements.md#FR-{N}` (AC-37.6)
- [ ] FR-39 round-trip: after `upsert` then `pull_acs`, the returned AC list
      is identical (after normalization) to what was pushed — no infinite
      reconciliation (AC-39.6)

### End-to-end flow

- [ ] Fresh-project `/setup → linear|jira|asana → pull_acs` round-trip
      succeeds; `mode: <tracker>` recorded in CLAUDE.md
- [ ] `/implement` pre-flight fetches ticket, records `updatedAt`, and runs
      FR-39 diff/resolve loop
- [ ] Edit an AC on the tracker side, re-run `/implement` — FR-39 surfaces
      the `tracker-only` or `edited-both` classification and prompts
- [ ] Pass gate → `/gate-check` toggles the AC on the tracker (unless
      adapter declares no `push_ac_toggle`)
- [ ] Create PR → `/pr` transitions status to `in_review` and optionally
      updates ticket description with PR URL
- [ ] `/setup --migrate <tracker> → none` pulls ACs into local
      `specs/requirements.md` and leaves tracker tickets intact

## Latency expectations (NFR-6)

Each MCP op should complete within ~5s under normal network conditions.
Skills show a `"waiting on tracker..."` indicator if any single call exceeds
2s. Latency is not a runtime gate, but adapters that consistently exceed
these bounds should document the slow path here so users aren't surprised.

## Known adapter quirks

### Linear

- Description-stored ACs; Linear normalizes markdown on the server side, so
  `adapters/linear/src/normalize.ts` is the canonical form on both pull
  and push (AC-39.6). Without it, reconcile loops fire every run.
- **V1 SSE endpoint (`https://mcp.linear.app/sse`) is deprecated** — shutdown
  2026-05-11. `/setup` detects the stale endpoint in `claude mcp list` output
  and offers a dry-run diff to V2 `https://mcp.linear.app/mcp` (AC-30.9).

### Jira

- AC custom-field GID is **per-tenant**. `/setup` runs one-time discovery
  via `/rest/api/3/field` introspection and records
  `jira_ac_field: customfield_XXXXX` in `## Task Tracking` (AC-30.6).
  `adapters/jira/src/discover_field.ts` is the helper that performs the
  lookup.
- Self-hosted Jira is **explicitly not supported** in v1 (specs/requirements
  §5 M12 out-of-scope). Cloud Atlassian MCP only.

### Asana

- ACs live as subtasks; checkbox state = subtask `completed` boolean
  (AC-37.3).
- Asana descriptions use restricted HTML, not Markdown. The adapter rounds
  tripping through `adapters/asana/src/html_to_md.ts` +
  `md_to_html.ts` — the round-trip invariant
  `html → md → html === html` must hold.
- Branch names rarely carry Asana gids; FR-32 AC-32.5 supports **URL paste**
  as the interactive fallback (`https://app.asana.com/0/<proj>/<id>`).
- Status convention varies per workspace (`section` / `custom_enum` /
  `completed_boolean`); `/setup` discovers it and records in
  `asana_status_convention`.

### Custom

- See `adapters/_template.md` plus the "Authoring a custom adapter" section
  above. Community-contributed adapters must pass the Conformance Checklist
  (Tier 5) before merging.

## Worked example — a minimal custom adapter for GitHub Issues

Illustrative only; not shipped. Shows how the 4-op interface maps onto a
tracker we don't bundle.

1. Frontmatter:
   ```yaml
   ---
   name: github
   mcp_server: github
   ticket_id_regex: '^gh-([0-9]+)$'
   ticket_id_source: branch-name
   ac_storage_convention: description-section
   status_mapping:
     in_progress: open
     in_review: open
     done: closed
   capabilities:
     - pull_acs
     - push_ac_toggle
     - transition_status
     - upsert_ticket_metadata
   ticket_description_template: |
     {fr_body}

     ---

     Source: specs/requirements.md#{fr_anchor}
   helpers_dir: adapters/github/src
   ---
   ```
2. `pull_acs` → `mcp__github__get_issue` + parse `## Acceptance Criteria`
   section from the body. Reuse Linear's `normalize.ts` as a starting point
   since both are description-section storage.
3. `push_ac_toggle` → `mcp__github__update_issue` (rewrite description with
   the toggled checkbox).
4. `transition_status` → `mcp__github__close_issue` / `reopen_issue`
   (GitHub has only two states).
5. `upsert_ticket_metadata` → `mcp__github__create_issue` /
   `mcp__github__update_issue`.

Run the Conformance Checklist against a real GitHub repo. If any op can't
be expressed cleanly (GitHub has no native status enum), drop it from
`capabilities` — the skill degrades per FR-38 AC-38.6 rather than failing.
