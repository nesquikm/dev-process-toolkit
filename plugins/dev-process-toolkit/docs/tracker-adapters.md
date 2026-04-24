# Tracker Adapters

How the plugin talks to Linear, Jira, and any custom tracker without
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
mode (AC-STE-9.8). If Bun is absent, `/setup` surfaces an NFR-10 canonical-shape
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
normalization, Jira field discovery).

## Schemas (technical-spec §7.3)

Full definitions live in `specs/technical-spec.md` §7.3. Summary:

- **Schema L — `## Task Tracking` section format.** Cross-skill. Heading
  presence is the mode probe; absence ≡ `mode: none`. Keys: `mode`,
  `mcp_server`, `jira_ac_field`. Duplicate keys are a malformed file and
  fail the skill with NFR-10 canonical shape. (Pre-v1.21.0 there was a
  legacy Tier-2 fallback key; STE-62 retired it as dead surface.)
- **Schema M — Adapter frontmatter.** Ten fields: `name`, `mcp_server`,
  `ticket_id_regex`, `ticket_id_source`, `ac_storage_convention`,
  `status_mapping`, `capabilities`, `project_milestone`,
  `ticket_description_template`, `helpers_dir`. Capabilities drive
  STE-16 AC-STE-16.6 graceful degradation; `project_milestone` (STE-38)
  opts the adapter into migration-time milestone binding.
- **Schema N — `AcceptanceCriterion` list.** Returned by `pull_acs`. Fields:
  `id`, `text`, `completed`.
- **Schema O — `TicketMetadata`.** Internal; tracked for concurrency via
  `updated_at` (AC-STE-11.2, AC-STE-11.3).
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
     NFR-10 canonical-shape warning (STE-16 AC-STE-16.6).
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

Each shipped adapter (Linear, Jira, custom) must pass this checklist
against a real tracker instance before release. No automated harness in v1
(test accounts + OAuth + teardown are too heavy); pass markers are recorded
in the adapter's PR description.

**Tier 5 status at v1.15.0 ship:** the checklist is documented; execution
against live Linear/Jira tenants has **not** been performed in the
v1.15.0 implementation session. MCP tool names in each adapter are marked
"provisional (Phase H conformance)" and must be verified once an
authenticated MCP is available. Phase H Task 1 (mode-none regression) is
the hard v1.15.0 ship gate; Tier 5 completion is the next operator's
responsibility.

### Prerequisites

- [ ] Bun ≥ 1.2 installed: `bun --version`
- [ ] Tracker MCP reachable: `claude mcp list` shows the server as `✓ Connected`
- [ ] Test ticket created in the tracker with 3+ ACs (2 checked, 1 unchecked)

### `pull_acs`

- [ ] Returns Schema N list (objects with `id`, `text`, `completed`)
- [ ] Non-AC content (comments, description preamble, attachments) discarded at
      parser boundary (STE-13)
- [ ] Empty-AC ticket fails the skill with `"No acceptance criteria found in
      ticket <ID>"` in NFR-10 canonical shape (AC-STE-13.4)
- [ ] Normalization round-trips: `normalize(normalize(x)) === normalize(x)`
      holds for Linear; equivalent invariant for Jira

### `push_ac_toggle`

- [ ] Toggling a single AC in the tracker updates only that checkbox (other
      ACs unchanged, no description rewrites beyond the minimal diff)
- [ ] Linear: semantic markdown diff used, not string diff — no Linear
      server-side normalization loop (AC-STE-15.5)
- [ ] If adapter does not declare `push_ac_toggle` in capabilities, skills
      degrade with an NFR-10 canonical-shape reminder (STE-16 AC-STE-16.6)

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
      to `specs/requirements.md#FR-{N}` (AC-STE-15.6)
- [ ] STE-17 round-trip: after `upsert` then `pull_acs`, the returned AC list
      is identical (after normalization) to what was pushed — no infinite
      reconciliation (AC-STE-17.6)

### End-to-end flow

- [ ] Fresh-project `/setup → linear|jira → pull_acs` round-trip
      succeeds; `mode: <tracker>` recorded in CLAUDE.md
- [ ] `/implement` pre-flight fetches ticket, records `updatedAt`, and runs
      STE-17 diff/resolve loop
- [ ] Edit an AC on the tracker side, re-run `/implement` — STE-17 surfaces
      the `tracker-only` or `edited-both` classification and prompts
- [ ] Pass gate → `/gate-check` toggles the AC on the tracker (unless
      adapter declares no `push_ac_toggle`)
- [ ] Create PR → `/pr` transitions status to `in_review` and optionally
      updates ticket description with PR URL
- [ ] `/setup --migrate <tracker> → none` pulls ACs into local
      `specs/requirements.md` and leaves tracker tickets intact

## Capability-aware degradation (STE-16 AC-STE-16.6)

Each adapter's `capabilities:` frontmatter list declares which of the four
ops it supports. A missing capability is an **opt-out**, not a failure:
skills surface an NFR-10 canonical-shape warning and continue. Gate/PR/save
verdicts are unaffected by missing capabilities — they only affect the
tracker-side side effect.

| Missing op | Where it matters | Degradation |
|-----------|-------------------|-------------|
| `pull_acs` | `/implement`, `/gate-check`, `/spec-review`, `/spec-write`, migration | Hard fail — adapter without `pull_acs` can't function; skills fail with NFR-10 canonical shape at pre-flight. |
| `push_ac_toggle` | `/gate-check` on gate pass | Skip the push; print canonical-shape warning telling the user to toggle manually. Gate verdict unchanged. |
| `transition_status` | `/pr` post-create, migration `tracker → none` "close tickets" prompt | Skip the transition; print canonical-shape warning. PR still created; migration still completes. |
| `upsert_ticket_metadata` | `/spec-write` post-save, STE-17 `keep local` / `merge`, `/pr` PR-link update, migration `none → tracker` / `<tracker> → <other>` | Skip the push; print canonical-shape warning. Local save still commits; PR still created; migration to-tracker becomes impossible (the user has to pick a different target). |

`pull_acs` is the only hard requirement — it's the foundation of every
skill's tracker-mode branch. The other three are each opt-outable with a
user-visible warning.

## Migration-time adapter behaviours (STE-38, STE-39)

`/setup --migrate none → <tracker>` surfaces two adapter-configurable
behaviours beyond the 4-op contract above. Both live in Schema M
frontmatter and keep tracker-specific logic out of the skill.

### Project Milestone mapping (STE-38)

Each FR declares its local milestone via frontmatter `milestone: M<N>`.
Migration can bind the pushed ticket to a tracker-native release or
project milestone so the tracker view mirrors the spec's milestone
grouping. Opt in via the `project_milestone: true` boolean (Schema M).

Side-by-side per-adapter behaviour:

| Adapter | `project_milestone` | FR `milestone:` → tracker field | Missing-milestone handling |
|---------|---------------------|---------------------------------|----------------------------|
| Linear  | `true`              | `save_issue.milestone` — matched by name starting with `M<N>` (case-sensitive, exact-prefix) on the configured project. | Prompt once per missing `M<N>`: `[1] Create it / [2] Skip milestone binding for these N FRs / [3] Cancel migration`. |
| Jira    | `false`             | Not mapped at push time — log one line `"Jira does not map milestones at push time; use Jira fixVersions manually."`; operators bind `fixVersions` manually after migration. | N/A (skipped). |
| Custom (`_template`) | `false` (default) | Opt in by flipping to `true`; use the Linear section below as the reference implementation. | Implementer's choice — follow the Linear 3-way prompt shape if adding support. |

Custom adapters that add a native "release milestone" field should flip
`project_milestone` to `true` and wire the mapping into their
`upsert_ticket_metadata` implementation — the Linear adapter is the
reference implementation for milestone mapping (see
`adapters/linear/` and `adapters/linear.md`).

### Initial ticket state (STE-39)

Bulk-creating tickets without picking an initial state lands everything
in Backlog, which misrepresents already-shipped migrations. The
`/setup --migrate` flow prompts once for the bulk default.

`status_mapping` (Schema M) is the declarative allowlist of legal
initial states: migration resolves the operator's canonical choice
(`in_progress` / `in_review` / `done`) through the adapter's
`status_mapping` and fails the prompt with NFR-10 canonical shape if
the choice isn't mapped. Adapter authors who want to support
non-default initial states in migration simply add those mappings —
there is no parallel allowlist field to keep in sync. The chosen
default is captured in the sync-log entry so future audits can see
which bulk-state each migration picked (AC-STE-39.5).

## Latency expectations (NFR-6)

Each MCP op should complete within ~5s under normal network conditions.
Skills show a `"waiting on tracker..."` indicator if any single call exceeds
2s. Latency is not a runtime gate, but adapters that consistently exceed
these bounds should document the slow path here so users aren't surprised.

## Silent no-op trap (cross-adapter)

Some tracker MCP tools — notably Linear's `mcp__linear__save_issue` —
accept unknown parameter names without raising a validation error and
return a successful-looking payload even when nothing mutated. If an
adapter driver passes the wrong key (`status` instead of `state`,
`assigneeEmail` instead of `assignee`, etc.), the write silently
no-ops and the skill thinks the transition landed. Observed
2026-04-22 during `/implement STE-36 STE-37` (STE-46).

**Rule for every adapter driver:** after any write (`transition_status`,
`upsert_ticket_metadata`, `push_ac_toggle`), re-fetch the ticket and
assert the ticket's `updatedAt` (or `startedAt` / `completedAt`) advanced
past the pre-call value before reporting success.

`adapters/_shared/src/tracker_provider.ts` encodes this uniformly:
`TrackerProvider.claimLock` and `TrackerProvider.releaseLock` perform a
post-call `getTicketStatus` and throw `TrackerWriteNoOpError` (NFR-10
canonical shape) if `updatedAt` did not advance. Drivers MUST populate
`TicketStatusSummary.updatedAt` for the guard to fire; a driver that
omits the field silently disables the guard.

See `adapters/linear.md` § Silent no-op trap for the Linear-specific
parameter name table. New adapters SHOULD mirror that pattern in their
own adapter markdown.

## Known adapter quirks

### Linear

- Description-stored ACs; Linear normalizes markdown on the server side, so
  `adapters/linear/src/normalize.ts` is the canonical form on both pull
  and push (AC-STE-17.6). Without it, reconcile loops fire every run.
- **The `https://mcp.linear.app/sse` endpoint is retired.** `/setup`
  detects the stale endpoint in `claude mcp list` output and offers a dry-run
  diff to `https://mcp.linear.app/mcp` (Streamable-HTTP transport, AC-STE-9.9).

### Jira

- AC custom-field GID is **per-tenant**. `/setup` runs one-time discovery
  via `/rest/api/3/field` introspection and records
  `jira_ac_field: customfield_XXXXX` in `## Task Tracking` (AC-STE-9.6).
  `adapters/jira/src/discover_field.ts` is the helper that performs the
  lookup.
- Self-hosted Jira is **explicitly not supported** in v1 (specs/requirements
  §5 M12 out-of-scope). Cloud Atlassian MCP only.

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
`capabilities` — the skill degrades per STE-16 AC-STE-16.6 rather than failing.

## Provider Interface (M13, v1.16.0)

v2 layout introduces a typed `Provider` interface that unifies ID lifecycle, tracker sync, and lock management behind a single contract. Adapters compose under `TrackerProvider`; the 4-op M12 surface (`pull_acs`, `push_ac_toggle`, `transition_status`, `upsert_ticket_metadata`) is unchanged.

**TypeScript signatures** (from `adapters/_shared/src/provider.ts`, matching technical-spec.md §8.4 byte-for-byte):

```typescript
export interface Provider {
  mintId(): string;                                    // pure local; offline-safe
  getMetadata(id: string): Promise<FRMetadata>;
  sync(spec: FRSpec): Promise<SyncResult>;
  getUrl(id: string, trackerKey?: string): string | null;
  claimLock(id: string, branch: string): Promise<LockResult>;
  releaseLock(id: string): Promise<void>;
}
```

**Two implementations ship at v1.16.0:**

- **`LocalProvider`** — tracker-less path. `sync()` no-ops (`kind: 'skipped'`); `claimLock()` uses `.dpt-locks/<ulid>` files committed to the claiming branch + `git fetch --all` + cross-branch `ls-tree` scan (skippable via `DPT_SKIP_FETCH=1`).
- **`TrackerProvider`** — composes over the M12 adapter surface. `sync()` calls `upsertTicketMetadata`; `claimLock()` uses `getTicketStatus` → `transitionStatus('in_progress')` + `upsertTicketMetadata({assignee})`; `releaseLock()` → `transitionStatus('done')`.

**How adapters compose under `TrackerProvider`**:

`TrackerProvider` depends on an `AdapterDriver` interface that maps the 4-op contract to MCP tool calls. Real drivers make MCP calls; tests inject stubs. Existing adapter markdown files (`adapters/linear.md`, `adapters/jira.md`, `adapters/_template.md`) describe the MCP tool mappings; the driver glue layer (a TypeScript wrapper that turns those mappings into `AdapterDriver` method implementations) is wired at skill invocation time. **Existing adapter declarative markdown is unchanged from M12** — Provider is a compositional layer above it, not a replacement.

**`mintId()` invariant**: always local, never network-bound, for any provider. This is what makes offline authoring work uniformly across tracker-less and tracker modes (AC-STE-20.5). Tracker binding happens in `sync()`, not at mint time.

Full behavioral reference: `docs/v2-layout-reference.md`. Pattern summary: `docs/patterns.md` § Pattern 23.

## Registering tracker ID patterns for the resolver

**Ships at v1.17.0 (M14, STE-30 / STE-34).** The argument resolver at the entry of `/spec-write`, `/implement`, and `/spec-archive` (see `docs/resolver-entry.md`) detects tracker-shaped arguments by consulting adapter-supplied metadata. Adapters register their resolver surface via an optional **Schema W** frontmatter block:

```yaml
---
name: linear
# ... existing Schema M fields (mcp_server, ticket_id_regex, capabilities, …) …
resolver:
  id_pattern: '^[A-Z]+-\d+$'
  url_host: 'linear.app'
  url_path_regex: '/[^/]+/issue/([A-Z]+-\d+)'
---
```

**Schema W fields**:

| Field | Purpose | Example |
|-------|---------|---------|
| `id_pattern` | Regex matching bare tracker IDs as users paste them into `$ARGUMENTS`. Anchored with `^…$`. | `'^[A-Z]+-\d+$'` (Linear/Jira), `'^#?\d+$'` (GitHub) |
| `url_host` | Exact host portion of ticket URLs — the NFR-19 allowlist. Unknown hosts fall through the resolver (`kind: 'fallthrough'`); the resolver never "best-guesses." | `'linear.app'`, `'github.com'`, `'example.atlassian.net'` |
| `url_path_regex` | Regex with one capture group extracting the tracker ID from `url.pathname`. Keep the capture group tight. | `'/[^/]+/issue/([A-Z]+-\d+)'` (Linear) |

**Optional disambiguation**: when two trackers declare the same `id_pattern` shape (e.g., Linear and Jira both use `^[A-Z]+-\d+$`), the resolver disambiguates by *project prefix*. The shipped Linear and Jira adapters expose project prefixes via `ticket_id_regex` (Schema M, pre-existing); the resolver layer derives the prefix list from that regex. If a custom adapter has a single unambiguous prefix, encode it directly in `id_pattern` — explicit disambiguation data is only needed when your adapter's pattern collides with another configured adapter.

**Adapters that omit `resolver:`** remain usable through pre-M14 code paths — users pass ULIDs to `/spec-write`, `/implement`, `/spec-archive`. Auto-resolution is opt-in.

**Example: adding resolver metadata to a custom adapter**:

```yaml
---
name: clubhouse
mcp_server: clubhouse
ticket_id_regex: '^ch(\d+)$'
# ... other Schema M fields …
resolver:
  id_pattern: '^ch\d+$'
  url_host: 'app.clubhouse.io'
  url_path_regex: '/\d+/story/(\d+)/'
---
```

After editing the adapter file and re-running `/setup` (or restarting a session), `/spec-write ch123`, `/implement ch123`, and `/spec-archive ch123` will all resolve to the Clubhouse-linked local FR.

**Cross-refs**: `technical-spec.md` §9.3 (Schema W canonical), `docs/resolver-entry.md` (full decision table), `docs/patterns.md` § Pattern 24 (user-facing story).
