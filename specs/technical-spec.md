# Technical Specification

## 1. Architecture

### System Overview

The plugin ships Claude Code skills (Markdown prompt files), agents, templates, docs, and a small set of TypeScript helper scripts invoked via `bun run`. There is no compiled code, no build step at release time, and no persistent runtime — all artifacts are files Claude reads and writes during skill execution. Tracker-mode helpers and the v1→v2 migration tool are the only non-prompt code; they are shipped as `.ts` source and executed by Bun on demand.

Runtime layers:

```
┌─────────────────────────────────────────────────┐
│         Skills (mode-aware)                     │
│  /setup /spec-write /implement /gate-check /pr  │
│  /spec-review /spec-archive /tdd /debug /brainstorm│
│  /simplify /visual-check                        │
└──────────────┬──────────────────────────────────┘
               │ resolveProvider(CLAUDE.md ## Task Tracking)
               ▼
┌─────────────────────────────────────────────────┐
│         Provider Interface (+ IdentityMinter)   │
│  getMetadata() sync() getUrl()                  │
│  claimLock() releaseLock() getTicketStatus()    │
│  filenameFor()                                  │
│  IdentityMinter { mintId() }  ← LocalProvider   │
└──────────────┬──────────────────────────────────┘
               │
     ┌─────────┴─────────┐
     ▼                   ▼
┌────────────┐   ┌─────────────────┐
│LocalProvider│  │ TrackerProvider │ → Adapter Layer
│(tracker-   │  │ (wraps adapter  │    (declarative .md
│ less)      │  │  4-op surface)  │    + bun-run helpers)
└────────────┘  └────────┬────────┘        │
                         │                  ▼
                         ▼           ┌───────────────┐
                 ┌───────────────┐   │ tracker MCP   │
                 │ tracker MCP   │   │ (Linear/Jira) │
                 └───────────────┘   └───────────────┘
```

### Repository Layout

```
dev-process-toolkit/
├── .claude-plugin/marketplace.json
├── plugins/dev-process-toolkit/
│   ├── .claude-plugin/plugin.json
│   ├── skills/                          # 12 user-invocable SKILL.md files
│   ├── agents/code-reviewer.md          # canonical review rubric (FR-22)
│   ├── templates/                       # CLAUDE.md + spec templates + settings.json
│   ├── adapters/                        # tracker integration surface
│   │   ├── _template.md  _template/src/
│   │   ├── linear.md     linear/src/
│   │   ├── jira.md       jira/src/
│   │   └── _shared/src/                 # provider, resolve, ulid
│   ├── docs/                            # methodology, patterns, adaptation-guide, reference docs
│   ├── examples/                        # stack-specific CI starter configs
│   └── tests/                           # bun tests for helpers + conformance probes
├── specs/                               # v2 layout (file-per-FR)
└── CHANGELOG.md  README.md  CLAUDE.md
```

### Generated specs directory (downstream user projects, v2 layout)

```
specs/
├── requirements.md                      # cross-cutting: overview, NFRs, architecture narrative
├── technical-spec.md                    # cross-cutting: schemas, contracts, ADRs
├── testing-spec.md                      # cross-cutting: framework, strategy, conventions, coverage
├── frs/
│   ├── fr_<ulid>.md                     # Schema Q — one file per FR
│   └── archive/fr_<ulid>.md             # archived FRs (git-moved; status: archived)
├── plan/
│   ├── M<N>.md                          # Schema T — one file per milestone
│   └── archive/M<N>.md                  # archived milestones
└── .dpt-locks/<ulid>                    # Schema S — tracker-less lock file (committed)
```

The v1 monolithic layout (a single `specs/requirements.md` holding every FR, plus a flat per-milestone archive directory) is supported for detection-and-migration only; new projects start in v2.

### Design Invariants

| Invariant | Statement | Enforcement |
|-----------|-----------|-------------|
| Skill file cap | Every SKILL.md ≤ 300 lines | NFR-1; overflow extracted to `docs/<skill>-reference.md` |
| Filename immutability | FR ULID in filename equals `id:` in frontmatter; never renamed post-mint | NFR-15; `/gate-check` v2 probe |
| Absence-is-default | `## Task Tracking` missing ⇒ `mode: none`; no line emitted by `/setup` | Pattern 9 (backward compat) |
| Deterministic gates | Compiler/linter/tests override LLM judgment; gate outputs `GATE PASSED` / `PASSED WITH NOTES` / `FAILED` | Schema F |
| ACs are binary | Pass/fail, no "good enough" | `/implement` Phase 3 Stage A |
| Self-review bounded | Max 2 rounds then escalate | `/implement` Phase 3 |
| Human approval before commit | Phase 4 step 15 pauses for explicit OK | `/implement` skill body |
| Cross-cutting specs carry no milestone frames | `^#{1,3} M\d+` forbidden in `specs/technical-spec.md` / `specs/testing-spec.md` | FR-63 AC-63.6 `/gate-check` probe |

## 2. Data Model

No runtime database. All state lives in Markdown + YAML files Claude reads and writes per skill invocation. The v1→v2 migration introduced four structured file types, all YAML-frontmatter Markdown:

| File | Schema | Purpose |
|------|--------|---------|
| `specs/frs/<ulid>.md` | Schema Q | one per FR — requirement, ACs, tech design, testing, notes |
| `specs/plan/<M#>.md` | Schema T | one per milestone — goal, scope, tasks, gate |
| `.dpt-locks/<ulid>` | Schema S | tracker-less in-flight lock (committed to branch) |
| `CLAUDE.md ## Task Tracking` | Schema L | tracker mode, MCP server, sync log |

In-memory-only artifacts:

| Type | Scope | Produced by |
|------|-------|-------------|
| `AcceptanceCriterion[]` (Schema N) | adapter 4-op boundary | `pull_acs`, FR-39 diff loop |
| `TicketMetadata` (Schema O) | adapter internal | `upsert_ticket_metadata` |
| `ResolveResult` (Schema V) | skill entry | `resolveFRArgument` |
| `FRMetadata` / `SyncResult` / `LockResult` | Provider interface | `Provider` implementations |

## 3. Cross-Skill Schema Definitions

These schemas enforce consistency wherever one skill produces output another reads. Literal format is load-bearing — grep patterns and deterministic probes depend on it.

### Schema A: AC Traceability Line

Used by: `/gate-check` drift check, `/spec-review` traceability map.

```
AC-X.Y → src/file.ts:42, tests/file.test.ts:15
AC-X.Y → (not found)
```

Rules: `AC-{FR}.{N}` → comma-separated `file:line` pairs; `(not found)` literal for missing implementation; one line per AC.

### Schema B: Drift Label

Used by: `/gate-check`, `/spec-review`.

Literal string `potential drift` annotates code with no corresponding AC. Used as a cell value or inline annotation.

### Schema C: Deviation Table

Used by: `/implement` Phase 4 report, Spec Breakout.

```markdown
| Deviation | Classification | Resolution | Needs Confirmation? |
|-----------|---------------|------------|---------------------|
| description | underspecified/ambiguous/contradicts/infeasible | what was done | Yes/No |
```

Exactly 4 columns in this order. Classification is one of exactly 4 values. `Needs Confirmation?` is `**Yes**` (bold) for `ambiguous` provisional decisions, `No` otherwise.

### Schema D: Shallow Test Anti-Pattern List

Used by: `/tdd` RED phase, `/implement` Phase 3 Stage A. Same list, same order, in both skills:

1. `expect(fn).not.toThrow()` or `assert not raises` as the sole assertion
2. `assert result is not None` / `expect(result).toBeDefined()` without checking the value
3. Type-only checks (`isinstance()`, `typeof`) without verifying the actual content

### Schema E: Visual Check Report Format

Used by: `/visual-check` (MCP-assisted and manual fallback paths).

```
- ✓ Description of what passed
- ✗ Description of what failed
```

Same checkmark format regardless of path; enables consistent downstream consumption.

### Schema F: Gate Verdict Strings

Used by: `/gate-check` verdict + structured JSON status.

Exactly 3 values, exact casing: `GATE PASSED`, `GATE PASSED WITH NOTES`, `GATE FAILED`.

Drift findings produce `GATE PASSED WITH NOTES`, never `GATE FAILED` (per AC-1.4). Deterministic command failures always produce `GATE FAILED`.

### Schema H: Live-File Pointer Line (legacy v1)

Used by v1-layout archive pointers. v2 replaces pointer lines with `git mv` so the archived file is findable directly at `specs/frs/archive/<ulid>.md` or `specs/plan/archive/M<N>.md`. Legacy format retained for v1 detection only:

```
> archived: M{N} — {title} → specs/plan/archive/M{N}.md ({YYYY-MM-DD})
```

### Schema I: Drift Report Table

Used by: `/spec-archive` Post-Archive Drift Check, `/implement` Phase 4 Post-Archive Drift Check.

```markdown
| File | Section | Severity | Reason | Suggested action |
|------|---------|----------|--------|------------------|
| requirements.md | Overview (§1) | medium | "layered documentation set" framing contradicts in-flight code milestone | Rewrite Overview to reflect current milestone mix |
| requirements.md | §6 Traceability Matrix | high | Orphan row `AC-3.2` references archived FR-3 | Remove row |
```

Rules: 5 columns in this order; severity is `high` (Pass A orphan token) or `medium` (Pass B semantic drift); `Section` uses heading text or `§N` reference; `Suggested action` is one-line imperative. Empty-report case emits literal `No drift detected`. Pass A rows appear before Pass B rows. `technical-spec.md` rows are always advisory — never suggest deletion for this file (AC-21.9).

### Schema J: Agent-Tool Delegation Block {#schema-J}

Used by: `/implement` Phase 3 Stage B delegates to `code-reviewer` subagent via the `Agent` tool.

**Call site:** `skills/implement/SKILL.md` Phase 3 Stage B, Pass 1 + Pass 2 invocations.

**Parent responsibilities:** resolve `<base-ref>` (branch merge base, `HEAD~1`, or `HEAD`); gather Phase 1 AC checklist; run `git diff --name-status <base-ref>`.

**Return contract:** one line per criterion as `<criterion> — OK` or `<criterion> — CONCERN: file:line — <one-sentence reason>`, terminated by `OVERALL: OK` or `OVERALL: CONCERNS (N)`. Documented at the bottom of `agents/code-reviewer.md`.

**Integration rules:** `OVERALL: OK` → Stage B passes. `OVERALL: CONCERNS` → fix, re-gate, re-invoke on round 1; escalate on round 2. On Pass 1 CONCERNS → skip Pass 2, report literal `Pass 2: Skipped (Pass 1 critical findings)`.

**Fallback:** subagent error or unparseable shape → fall back to reading `agents/code-reviewer.md` and executing the rubric inline. Stage B is never skipped because delegation failed.

### Schema L: `## Task Tracking` section in CLAUDE.md

Used by: every mode-aware skill (probe at entry).

```markdown
## Task Tracking

mode: <none | linear | jira | custom>
mcp_server: <name from `claude mcp list`>
jira_ac_field: <customfield_XXXXX>
branch_template: <e.g. {type}/m{N}-{slug} or {type}/{ticket-id}-{slug}>
```

Read contract:

- Section presence probe: `grep -c '^## Task Tracking$' CLAUDE.md` — `0` ⇒ `mode: none`; `1` ⇒ section exists; anything else ⇒ NFR-10 canonical error.
- Key extraction: `grep -E '^<K>:[[:space:]]' | head -1 | sed 's/^<K>:[[:space:]]*//'`.
- Only `key: value` lines between `## Task Tracking` and the next `##`/`###` heading count.
- Blank value (`jira_ac_field:` with nothing) = "not applicable in this mode" — legal only for tracker-specific keys.
- Duplicate keys forbidden → NFR-10 canonical error.
- Absence ⇒ `mode: none` (AC-29.5). `/setup` does not emit `mode: none` explicitly — absence is canonical.
- Absent `branch_template:` ⇒ branch automation disabled in `/implement` (STE-64 AC-STE-64.1); all other keys and behaviors unchanged. Seeded by `/setup` with scope-aware default; editable at any time.
- Audit trail: `git log` + `git blame` — no separate sync-log subsection is maintained. See `docs/patterns.md` § Audit trail.
- The legacy Tier-2 fallback key (retired in v1.21.0) is ignored if still present. Ticket binding runs through branch-regex (Tier 1) then the interactive prompt (Tier 2) only.
- **Canonical-key closed set (STE-114 AC-STE-114.1).** Top-level keys are limited to exactly `{mode, mcp_server, jira_ac_field, branch_template}`. Sub-section contents (`### Linear`, `### Jira`, etc.) are scoped out and free-form. Non-canonical top-level keys → `/gate-check` failure via the `task-tracking-canonical-keys` probe (gate-check #21). One-time migration helper for projects that picked up the drift before the constraint landed: `scripts/migrate-task-tracking-canonical.ts` (dry-run; outputs unified diff). Full rationale: `docs/patterns.md` § Schema L Canonical keys.

### Schema M: Adapter `<tracker>.md` frontmatter

YAML frontmatter at the top of each adapter markdown. Fields: `name`, `mcp_server`, `ticket_id_regex`, `ticket_id_source`, `ac_storage_convention`, `status_mapping`, `capabilities`, `project_milestone`, `ticket_description_template`, `helpers_dir`. `project_milestone` (boolean) opts the adapter into migration-time binding of each pushed ticket to a tracker-native release/project milestone. `status_mapping` doubles as the allowlist of legal initial states for bulk migration. `resolver` (optional sub-block) adds Schema W fields for argument resolution.

### Schema N: `AcceptanceCriterion` list

```typescript
type AcceptanceCriterion = {
  id: string;        // "AC-29.1"
  text: string;      // canonical-form text
  completed: boolean;
};
type AcList = AcceptanceCriterion[];
```

### Schema O: `TicketMetadata` (adapter-internal)

```typescript
type TicketMetadata = {
  id: string;
  title: string;
  description: string;    // canonical markdown
  status: string;         // adapter-mapped canonical: in_progress | in_review | done
  updated_at: string;     // ISO 8601
};
```

### Schema P: Helper script I/O contract

Every helper (`adapters/<tracker>/src/<helper>.ts`): JSON on stdin → JSON on stdout, errors on stderr + non-zero exit, no network calls. Invoked as `bun run adapters/<tracker>/src/<helper>.ts`. Deterministic pure functions.

### Schema Q: FR file frontmatter

Required for every `specs/frs/**/*.md`. The `id:` line is **mode-conditional** (STE-76 AC-STE-76.1):

**`mode: none`** — `id:` is REQUIRED and equals the filename stem byte-for-byte (the 6-char short-ULID tail):

```yaml
---
id: fr_01HZ7XJFKPXYZ123ABCDEF       # full ULID; filename stem is its 6-char tail (AC-41.2)
title: Tracker-backed spec IDs
milestone: M<N>                      # matches an M<N> in specs/plan/
status: active                       # active | in_progress | archived
archived_at: null                    # ISO date | null; set when status flips to archived
tracker: {}                          # empty map — mode-none has no tracker binding
created_at: 2026-04-21T10:30:00Z
---
```

**`mode: <tracker>`** — `id:` is ABSENT (STE-76 AC-STE-76.2, cross-mode symmetry dropped). The tracker ID is the canonical identity; filename stem + AC prefix derive from `tracker.<key>`:

```yaml
---
title: Tracker-backed spec IDs       # no id: line — tracker ID is the identity
milestone: M<N>
status: active
archived_at: null
tracker:
  linear: STE-76                     # tracker_key: ticket_id
created_at: 2026-04-21T10:30:00Z
---
```

Rules: `milestone` must match a key in `specs/plan/`. `tracker` keys written in alphabetical order. `archived_at` null unless `status: archived`. In `mode: none`, `id:` is immutable for the FR's lifetime and equals the filename stem (NFR-15). In tracker mode, the `id:` line is absent; the bimodal invariant is enforced by the `identity_mode_conditional` `/gate-check` probe (STE-86 AC-STE-86.5) and cross-referenced from NFR-15.

Archived FRs live at `specs/frs/archive/<stem>.md` with the same mode-conditional frontmatter plus `status: archived` and a non-null `archived_at`. No separate archive-file schema exists — Schema Q is the single source of truth on both sides of the active/archived boundary.

### Schema S: Lock file (`.dpt-locks/<ulid>`) — tracker-less mode

```yaml
ulid: fr_01HZ7XJFKPXYZ123ABCDEF
branch: feat/m<n>-<slug>
claimed_at: 2026-04-21T10:30:00Z
claimer: user@example.com                # git user.email (advisory)
```

Committed to the branch. Cross-branch visibility via `git fetch --all` + `git branch -r --contains .dpt-locks/<ulid>` (AC-46.2).

### Schema T: Plan file frontmatter (`specs/plan/<M#>.md`)

```yaml
---
milestone: M<N>
status: active                           # draft | active | complete
kickoff_branch: plan/M<N>-kickoff
frozen_at: 2026-04-21T10:30:00Z          # null if status=draft
revision: 1                              # incremented on each replan branch
---
```

Once `status: active`, content is immutable — any write fails with replan-branch guidance (AC-44.3).

### Schema V: `ResolveResult`

```typescript
export type ResolveKind = 'ulid' | 'tracker-id' | 'url' | 'fallthrough';

export interface ResolveResult {
  kind: ResolveKind;
  ulid?: string;
  trackerKey?: string;    // 'linear' | 'jira' | 'github' | custom
  trackerId?: string;     // e.g., 'LIN-1234', '42'
}
```

Pure function over `(argument, config)`; no I/O. Ordering: explicit prefix → ULID → URL → tracker-ID → fallthrough.

### Schema W: Adapter resolver metadata

Optional sub-block in adapter frontmatter (backward compatible with Schema M):

```yaml
resolver:
  id_pattern: '^[A-Z]+-\d+$'
  url_host: 'linear.app'
  url_path_regex: '/[^/]+/issue/([A-Z]+-\d+)/'
  prefixes: ['LIN', 'DPT']               # optional — enables prefix disambiguation
```

Adapters omitting `resolver` remain usable through the 4-op interface; they simply don't participate in argument auto-resolution. Built by `buildResolverConfig(claudeMdPath, adaptersDir)` (`adapters/_shared/src/resolver_config.ts`); malformed metadata surfaces as `MalformedAdapterMetadataError` (NFR-10 canonical refusal).

### Schema X: `## Docs` section in CLAUDE.md

Per-project docs-generation configuration. Read by `/docs`, `/ship-milestone`, and `/implement` Phase 4b via `readDocsConfig()` (`adapters/_shared/src/docs_config.ts`). Same grep-based read contract as Schema L. Absent section ≡ all three values `false` (docs disabled, backward-compatible default).

```
## Docs

user_facing_mode: true
packages_mode: true
changelog_ci_owned: false
```

Values are lowercase literal `true` / `false` (no quoting, no `yes`/`no`). Malformed value → `MalformedDocsConfigError` (NFR-10 canonical refusal).

### Schema Y: `ImpactSet`

Deterministic diff-extraction output, consumed by `/docs --quick` as LLM ground truth per NFR-22:

```typescript
export interface ImpactSet {
  symbols: SymbolChange[];          // public functions, classes, types, interfaces, consts
  routes: RouteChange[];            // HTTP routes, CLI commands, RPC entry points
  configKeys: ConfigKeyChange[];    // added/changed keys in package.json, plugin.json, etc.
  stateEvents: StateEventChange[];  // enum values, state-machine cases, action types
}
export interface SymbolChange {
  kind: "function" | "class" | "type" | "interface" | "const";
  name: string;
  file: string;
  change: "added" | "modified" | "removed";
  visibility: "public" | "internal";
}
```

Emitted by `computeImpactSet(diffInput)` (`adapters/_shared/src/impact_set.ts`). `visibility: "internal"` entries are retained in the struct but filtered from the LLM-passed set per NFR-22.

### Schema Z: `SignatureGroundTruth`

Mechanically-extracted public API signatures, consumed by `/docs --full` / `/docs --commit` as LLM ground truth per NFR-22:

```typescript
export interface SignatureGroundTruth {
  strategy: "typedoc" | "ts-morph" | "regex-fallback";
  modules: ModuleSignatures[];
  warnings: string[];
}
export interface ModuleSignatures {
  modulePath: string;
  exports: ExportSignature[];
}
export interface ExportSignature {
  name: string;
  kind: "function" | "class" | "type" | "interface" | "const" | "enum";
  signature: string;       // verbatim as it appears in source (or typedoc output)
  docComment?: string;
  sourceFile: string;
  sourceLineStart: number;
  sourceLineEnd: number;
}
```

Emitted by `extractSignatures(projectRoot, config)` (`adapters/_shared/src/signature_extractor.ts`). Strategy is recorded in the struct so downstream skills can display it (e.g., `/setup`'s packages-mode prompt).

### Schema AA: `/docs` fragment frontmatter

Per-fragment metadata for files written by `/docs --quick` to `docs/.pending/<fr-id>.md`. Read by `/docs --commit` during merge:

```yaml
---
fr: STE-72                          # or "_unbound" when FR cannot be resolved
impact_set:                         # from Schema Y; absent when STE-71 unavailable
  symbols: [...]
  routes: [...]
  configKeys: [...]
  stateEvents: [...]
target_section: reference           # one of: tutorials | how-to | reference | explanation
target_file: docs/reference/api/task_tracking_config.md
generated_at: 2026-04-23T16:00:00Z
---
```

`target_section` values match the four canonical Diátaxis anchors (Schema B). `target_file` must start with `docs/<target_section>/` or the fragment is rejected at merge time.

## Docs system

`/docs` writes doc content in two modes, both gated on Schema X's `user_facing_mode` and `packages_mode`:

1. **Fragment staging** (`/docs --quick`, invoked by `/implement` Phase 4b). Writes one file to `docs/.pending/<fr-id>.md` per `/implement` run. Fragment content is bound to the `ImpactSet` (Schema Y) computed from the current diff; LLM prompt pins the set as ground truth (NFR-22). `.pending/` is tracked in git — fragments commit alongside their FR and survive until `/ship-milestone` merges them. Multiple fragments targeting the same canonical file are reconciled by `/docs --commit` in `generated_at`-ascending order.

2. **Canonical regeneration** (`/docs --full`, invoked by `/ship-milestone` via `/docs --commit --full`). Rewrites the entire `docs/` tree under the Diátaxis layout (Schema B anchors). Packages-mode reference content is driven by `SignatureGroundTruth` (Schema Z); user-facing content is LLM-generated prose + mermaid. Both `--full` and `--commit` require explicit human approval on the unified diff before any file write.

The fragment lifecycle spans exactly one milestone: fragments are created during the milestone's `/implement` runs, merged at `/ship-milestone`, deleted on merge. Orphan fragments (fragment written but FR later abandoned) surface in `/ship-milestone`'s diff for manual review; they are never silently merged.

### Schema BB: `/setup` output conventions

Used by: `/setup` (writer), `/gate-check` probes #17–22 (readers).

The canonical output set `/setup` produces:

| File | Contract | Probe |
|------|----------|-------|
| `<!-- generated by /dev-process-toolkit:setup -->` (top of CLAUDE.md) | Single HTML comment marker. Lets gate-check distinguish toolkit-managed CLAUDE.md from hand-written ones without scanning content. | (load-bearing for #19, #22) |
| `CLAUDE.md` | Always emit `## Docs` section as a real heading with all-false defaults when no answer provided (STE-107 AC-STE-107.1). Always commit the file (STE-109 AC-STE-109.1). | #18 `claudemd-docs-section-present`, #22 `setup-bootstrap-committed` |
| `## /setup audit` section in CLAUDE.md | Created lazily by `appendAuditEntry` (`adapters/_shared/src/setup/audit_log.ts`) on first default-applied step. Bullet shape: `- <ISO-date> step:<N> (<field>) value:<JSON-quoted> reason:"<reason>"`. Append-only (STE-108 AC-STE-108.7). | #19 `setup-audit-section-presence` |
| `.claude/settings.json` | `permissions.allow` derived from `templates/permissions.json` keyed by detected stack via `canonicalAllowList`. Pre-existing files merged via `mergeAllowList` (preserves user additions, dedups). Required, abort on failure (STE-106 AC-STE-106.3). | (write-required) |
| `.mcp.json` | Required when `mode != none`. Contains `mcpServers.<adapter>` matching the active tracker's `mcp_server` key (STE-106 AC-STE-106.5). Required, abort on failure. | #17 `setup-output-completeness` |
| `tests/.placeholder.test.ts` | Bun-stack only. Carries the marker comment `// generated by /dev-process-toolkit:setup — Bun zero-match workaround (see examples/bun-typescript.md)` until a real `*.test.ts` ships. Prevents `bun test`'s zero-match-exit-1 (STE-113 AC-STE-113.3). | #20 `bun-zero-match-placeholder` |
| Bootstrap commit | `chore: bootstrap dev-process-toolkit (v<plugin-version>)` — single atomic commit covering the canonical output set + `.gitkeep` stubs in `specs/frs/{,archive/}` and `specs/plan/archive/`. Required at end of /setup; autonomous mode default-applies (STE-109 AC-STE-109.3). | #22 `setup-bootstrap-committed` |

Probe #21 `task-tracking-canonical-keys` enforces Schema L's closed-set (STE-114): non-canonical top-level keys under `## Task Tracking` → GATE FAILED. Subsection contents (`### Linear`, `### Jira`) are scoped out.

## 4. Architectural Contracts

### Provider Interface

```typescript
// Base contract — every Provider implementation honors this.
export interface Provider {
  getMetadata(id: string): Promise<FRMetadata>;
  sync(spec: FRSpec): Promise<SyncResult>;
  getUrl(id: string, trackerKey?: string): string | null;
  claimLock(id: string, branch: string): Promise<LockResult>;
  releaseLock(id: string): Promise<"transitioned" | "already-released">;
  getTicketStatus(ticketId: string): Promise<{ status: string }>;  // STE-54 read-side probe
  filenameFor(spec: FRSpec): string;                               // STE-60
}

// Capability sub-interface (STE-85) — only mode-none providers implement
// it. Any attempt to call `mintId()` on a value statically typed as the
// base `Provider` is a TS2339 error: the invariant "tracker-mode code
// never mints a ULID" is type-enforced rather than convention.
export interface IdentityMinter {
  mintId(): string;                                                // pure local
}
```

Two implementations ship:

- **`LocalProvider implements Provider, IdentityMinter`** — `mintId()` returns a ULID; `sync()` returns `{kind: 'skipped', …}`; `claimLock()` performs `git fetch --all` + cross-branch check then writes/commits `.dpt-locks/<ulid>`; `releaseLock()` deletes + commits. `getTicketStatus()` returns the sentinel `{ status: 'local-no-tracker' }`.
- **`TrackerProvider implements Provider`** (not `IdentityMinter` — STE-76 dropped the `id:` ceremony from tracker-mode FRs; STE-85 made the ban structural) — wraps the adapter surface. `sync()` calls `upsert_ticket_metadata` + `pull_acs`; `claimLock()` → `transition_status('in_progress')` + assignee; `releaseLock()` → `transition_status('done')` or `'unstarted'` per context. `getTicketStatus()` delegates to the driver's `getTicketStatus` and returns the adapter-canonical status string verbatim, used by `/implement` Phase 4 post-release verification (AC-STE-54.2) and `/gate-check` ticket-state drift detection (AC-STE-54.3).

### Adapter 4-Op Interface

Exactly four operations, implemented by every adapter:

| Operation | Signature | Purpose |
|-----------|-----------|---------|
| `pull_acs` | `(ticket_id) → AcList` | Fetch current AC state |
| `push_ac_toggle` | `(ticket_id, ac_id, state: bool) → void` | Toggle a single AC checkbox |
| `transition_status` | `(ticket_id, status) → void` | Move ticket to canonical status |
| `upsert_ticket_metadata` | `(ticket_id_or_null, title, description) → ticket_id` | Create (null id) or update (existing); returns final id |

Adapter markdown files declare `capabilities: [...]`; a missing capability produces a one-line NFR-10-shape warning and skill proceeds (Pattern: graceful degradation).

### Lock Mechanism

**Tracker-less state:** `{fs_presence: absent | present-on-current | present-on-other}`. Transitions: `claimLock` writes `.dpt-locks/<ulid>`; `releaseLock` deletes; cross-branch visibility via `git fetch --all` + `git branch -r --contains`.

**Tracker state:** derived live from `TrackerProvider.getMetadata(id)` — status + assignee map to `absent`/`present-on-current`/`present-on-other`. `claimLock` → `transition_status('in_progress')` + assignee; `releaseLock` → `transition_status('done')` on Phase 4 completion, `'unstarted'` on explicit release.

### Resolver Algorithm (FR-32, FR-53)

`resolveFRArgument(arg, config): ResolveResult` — pure function. Decision order:

1. Explicit prefix (`<tracker>:<id>`) — always wins if `<tracker>` is a configured key.
2. ULID regex (`^fr_[0-9A-HJKMNP-TV-Z]{26}$`) → `{kind: 'ulid'}`.
3. URL with registered host + matching path regex → `{kind: 'url'}`.
4. Tracker-ID pattern match; on multi-candidate, prefix disambiguation; on still-ambiguous → `AmbiguousArgumentError`.
5. `fallthrough` — skill handles per its pre-resolver contract (milestone codes, free-form text, `all`, `requirements`, …).

`findFRByTrackerRef(specsDir, trackerKey, trackerId)` scans `specs/frs/**/*.md` frontmatter; short-circuits on first match. Archive excluded by default. Miss on `/spec-archive` → refuse; miss on `/spec-write` or `/implement` → `importFromTracker(...)`.

Branch-name interop: on disagreement, the argument wins with an NFR-10-shape warning (AC-53.5).

Full reference: `docs/resolver-entry.md`.

## 5. Dependencies

- **Bun runtime** — required in tracker mode and for the v1→v2 migration tool. Version floor: Bun ≥ 1.2. `/setup` verifies via `bun --version` and hard-stops mode recording until Bun is available. Helpers ship as `.ts` source only; no compile step, no per-platform binaries, no `package.json`.
- **Tracker MCP servers** (external, user-installed via `claude mcp add`):
  - Linear: `https://mcp.linear.app/mcp` (Streamable HTTP).
  - Jira: `https://mcp.atlassian.com/v1/mcp` (Rovo).
- **`claude mcp list` CLI** — used by `/setup` for MCP introspection across enterprise/user/project/local scopes.

Downstream projects that adopt the plugin carry whatever dependencies their stack needs (npm, pip, cargo, …); those are the user's project dependencies, not plugin dependencies. CI starter configs under `plugins/dev-process-toolkit/examples/` are template YAML files, not generated artifacts.

## 6. Risks & Considerations

| Risk | Severity | Mitigation |
|------|----------|------------|
| Skill file exceeding NFR-1 300-line cap | Medium | Recheck `wc -l` after every skill edit; overflow extracts to `docs/<skill>-reference.md` |
| Drift detection false positives eroding trust | Medium | Drift always produces `GATE PASSED WITH NOTES`, never `GATE FAILED` (AC-1.4); advisory framing preserved |
| Cross-skill schema drift (Schemas A–W) | Medium | Tier 1 grep checks in testing-spec + automated probes (`probe-parity.test.ts`, `archive-path-drift.test.ts`, `gate-check-milestone-strip-lint.test.ts`) |
| Tracker mode concurrent edits (local vs. remote) | High | FR-33 `updatedAt` recording + FR-39 mandatory diff/resolve before push; Pattern: optimistic concurrency |
| `/setup` writes colliding with other Claude Code tooling | Medium | DD — `/setup` dry-runs every settings.json diff and waits for confirm; per-project scope preferred over user/global |
| Wrong-ticket mutation via stale branch regex | High | FR-32 mandatory confirmation at every mutating skill entry |
| Linear description normalization loop → infinite reconcile | High | `adapters/linear/src/normalize.ts` canonical-form normalization both directions; Tier 4 round-trip test asserts first-iteration convergence |
| Jira custom-field GIDs differ per tenant | Medium | Per-project discovery at `/setup`; recorded in CLAUDE.md `jira_ac_field`; never hard-coded |
| v1→v2 migration corrupts specs on edge inputs | High | Dry-run preview + backup tag + clean-tree precondition + atomic memory-staged writes; `git reset --hard <tag>` is always the rollback path |
| `.dpt-locks/` doesn't prevent two branches claiming same FR (tracker-less) | Medium | Documented trade-off (AC-46.6); `git fetch --all` catches most cases; tracker mode is the strict answer |
| Bun not installed for tracker-mode or migration | Low | `/setup` detects; surfaces `brew install bun` on macOS; hard-stop until available |
| Pass B (drift semantic scan) context bloat on large archives | Low | Schema I enforces title + goal brief only; Pass B cost is bounded by archive title length, not archive body length |
| Resolver prefix collision across two trackers (`FOO` in Linear + Jira) | Low | `<tracker>:<id>` disambiguation form is the documented remedy; `AmbiguousArgumentError` shape points the user at it |
| `implement/SKILL.md` or `gate-check/SKILL.md` approaching NFR-1 cap | Medium | Tier 1 `wc -l` checks each release; standing overflow rule extracts to companion doc |
| Stale release marker drift in `specs/requirements.md` | Low | `/gate-check` probe #7 warns when marker references a shipped `CHANGELOG.md` version (FR-62 AC-62.5) |
| Per-milestone drift creeping back into cross-cutting specs | Medium | `/gate-check` probe #8 + `tests/gate-check-milestone-strip-lint.test.ts` fail the gate on `^#{1,3} M\d+` matches (FR-63 AC-63.6) |
| LLM-returned branch `{type}`/`{slug}` inject shell metachars into `git checkout -b` (STE-64) | High | `buildBranchProposal` clamps each LLM-returned field to `[a-z0-9-]+` before template substitution; anything else truncates or drops. Renderer returns a pure string; skill's `git checkout -b` invocation quotes the argument; tests assert escape behavior for `$()`, backticks, newlines, spaces |
| Sweep deletes file referenced via runtime-constructed path / string concat that static grep misses (STE-63) | Medium | AC-STE-63.7 gate-check backstop after deletion; failing test = revert the specific deletion; pass 3 per-file judgment surfaces the file for human review before deletion; exemption list blocks `plugin.json`/`marketplace.json` manifest paths |
| Existing users upgrade and silently lose branch automation because their CLAUDE.md lacks `branch_template:` (STE-64) | Low | AC-STE-64.1 explicitly defines "absent ⇒ disabled" as the backward-compat story; CHANGELOG v1.22.0 notes the opt-in; `/setup` re-run seeds the key without disturbing other content |
| LLM returns stylistically poor `{slug}` (too long, too generic, non-kebab) under rare FR shapes (STE-64) | Low | AC-STE-64.5 truncation clamp (60-char total); `[e] edit` prompt path lets the user override any proposal; not a safety concern, only an ergonomics one |

## 7. Architecture Decision Records

| Decision | Choice | Rationale |
|----------|--------|-----------|
| FR numbering | Match issue/ticket 1:1 (not impl order) | Traceability with many ACs is more valuable than reading specs in impl order |
| Drift detection strictness | Advisory `GATE PASSED WITH NOTES`, never fail | Heuristic in a prompt context; false positives would erode trust in the deterministic gate |
| Spec breakout threshold default | 3 contradicts/infeasible deviations; configurable | Hardcoding prevents adaptation per project complexity |
| Archive mechanism | Move-based: `git mv` + frontmatter flip (v2, FR-45) | Disjoint path operations per ULID ⇒ no merge conflicts; contrast the v1 rewrite-archive-file hotspot |
| Archive directory layout (Superseded-by: FR-70) | Flat per-unit — archived FRs at `specs/frs/archive/<ulid>.md`, archived milestones at `specs/plan/archive/M{N}.md` | Per-unit archives avoid the cross-cutting rewrite that v1's flat per-milestone archive + rolling index file forced |
| Canonical ID | ULID in filename; tracker ID as frontmatter attribute | Repo-local canonical; tracker lifecycle (deletes, renames, multi-tracker) is attribute churn, not filesystem rename churn |
| `technical-spec.md` auto-archival | Never — ADRs use `Superseded-by:` in place | ADR community convention; ADRs document ongoing architectural constraints, not shippable work |
| Stable anchor IDs on headings | Required on milestones/FRs (`{#M{N}}`, `{#FR-{N}}`) | Headings get renamed; pointers must survive edits; CommonMark-standard syntax |
| Plan file immutability | Once `status: active`, frozen; replan-branch for changes | Plan is a ratified agreement, not a live dashboard; `/gate-check` warns on post-freeze edits |
| Tracker mode default | `none` (absence of `## Task Tracking` section) | Backward compatibility (NFR-2); zero disruption for existing users; adding tracker mode requires explicit `/setup` flow |
| Adapter distribution | Declarative `.md` + TypeScript helpers via `bun run` | Prose alone can't do Linear normalization or Jira field discovery; source-only distribution avoids per-platform binary packaging |
| Provider interface over mode branching | Single typed interface with two implementations | Eliminates per-skill "two modes" branching; `LocalProvider` provides a working baseline so skills are layout-aware without being tracker-aware |
| Two-stage code review (FR-23) | Pass 1 spec-compliance (fail-fast), Pass 2 code-quality | Pass 2 on a wrong-feature implementation is misleading; fail-fast on Pass 1 keeps cost equal to v1 on failures and doubles only on the happy path where the second pass is the value purchased |
| `disable-model-invocation` scope (FR-27) | Keep on `/setup`; drop on `/implement` + `/pr` | `/setup` has no in-skill human gate before writing config; others have Phase 4 commit-ask + pre-flight gates |
| Parallelization doc home (FR-25) | Standalone `docs/parallel-execution.md` + literal pointer in `/implement` | Inline blow NFR-1 budget; split across two docs fragments the topic; standalone + pointer keeps discoverable while honoring the line cap |
| Release-notes home | `CHANGELOG.md` (Keep a Changelog format) | Inline README release notes age badly; CHANGELOG is the standard convention; Release Checklist in CLAUDE.md enforces update discipline |
| CI configs as example files | `.github/workflows/gate-check.yml` per `examples/` stack | CI pipelines are too project-specific to auto-generate; examples are starting points |

---
