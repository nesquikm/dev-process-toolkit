# Changelog

All notable changes to the Dev Process Toolkit plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Update discipline:** this file must be updated on every version bump. See the Release Checklist in `CLAUDE.md` for the required steps.

## [1.17.0] — 2026-04-21 — "Tracker-native Entry"

Accepts tracker IDs (`LIN-1234`, `PROJ-42`, `#982`) and full tracker URLs as first-class arguments to `/spec-write`, `/implement`, and `/spec-archive`. A shared resolver at each skill's entry detects the argument kind (ULID / tracker-ID / URL / fallthrough) and routes through a single code path; a shared import helper handles the "tracker ref with no local FR yet" case so the three skills cannot drift. Tracker teams no longer need to look up an internal ULID to work on a ticket whose "real" ID is `LIN-1234` — the plugin accepts what they already know.

Pre-M14 argument forms continue unchanged: ULIDs, milestone codes (`M12`), anchors (`{#M3}`, `{#FR-7}`), and keywords (`all`, `requirements`, `technical`, `testing`, `plan`) all fall through to their pre-existing handlers byte-for-byte (NFR-18).

### Added

- **Resolver utility** (FR-51 / AC-51.1..9): `adapters/_shared/src/resolve.ts` — `resolveFRArgument(arg, config)` returns `{kind: 'ulid' | 'tracker-id' | 'url' | 'fallthrough', …}` via deterministic string parsing + config lookup (pure function, no I/O — NFR-17). `findFRByTrackerRef(specsDir, trackerKey, trackerId, {includeArchive?})` scans `specs/frs/**` frontmatter for a matching `tracker.<key>: <id>` and returns the ULID or null; archive excluded by default. Ordering: explicit-prefix → ULID → URL → tracker-ID → fallthrough (§9.4). Ambiguity across configured trackers throws `AmbiguousArgumentError` with both `<tracker>:<id>` candidates — never silently picks a winner (NFR-20).
- **Import helper** (FR-52/FR-53 shared): `adapters/_shared/src/import.ts` — `importFromTracker(trackerKey, trackerId, provider, specsDir, promptMilestone)` mints a ULID, writes `specs/frs/<ulid>.md` with tracker ACs auto-accepted (no FR-39 per-AC prompt loop on initial import — AC-52.5), calls `Provider.sync`, and regenerates `INDEX.md`. Empty-AC tickets get a TODO marker under `## Acceptance Criteria` (AC-52.7).
- **Schema W adapter metadata**: `resolver:` frontmatter block on `adapters/{linear,jira,_template}.md` declaring `id_pattern`, `url_host`, and `url_path_regex`. Adapter authors opt in to auto-resolution by adding this block; adapters omitting it continue to work via ULID-only arguments.
- **`/spec-write` tracker import** (FR-52 / AC-52.1..8): resolver at entry after FR-47 layout gate; tracker-id/url + find hit → edit existing, no import; miss → `importFromTracker` with auto-accepted ACs; fallthrough → pre-M14 free-form handling unchanged.
- **`/implement` tracker-ID entry** (FR-53 / AC-53.1..7): resolver between Provider resolution (FR-43) and `Provider.claimLock` (FR-46); tracker-id/url + miss → `importFromTracker` then lock claim; branch-name interop (FR-32) — argument wins with NFR-10-shape warning when branch name disagrees (AC-53.5).
- **`/spec-archive` tracker-ID resolution** (FR-54 / AC-54.1..6): resolver at entry; tracker-id/url + hit → archive via `git mv` + status flip on resolved ULID; miss → refuse with NFR-10 canonical error (never auto-imports — AC-54.4); milestone codes (`M12`), anchors, and heading strings fall through unchanged.
- **Documentation** (FR-55 / AC-55.1..5): `docs/patterns.md` § Pattern 24 "Tracker-ID Auto-Resolution" (user-facing story + decision table); `docs/tracker-adapters.md` § "Registering tracker ID patterns for the resolver" (Schema W reference + custom-adapter example); `docs/resolver-entry.md` (canonical per-skill decision table — referenced from each skill to keep them under the NFR-1 300-line cap).
- **Regression fixtures**: `tests/fixtures/resolver/{linear-only,linear-and-jira,overlapping-prefixes,no-trackers}/` — four paired `CLAUDE.md` + `specs/frs/` trees covering AC-51.2..7 configuration combinations. Integration tests exercise resolver + `findFRByTrackerRef` against each.

### Changed

- `plugin.json` + `.claude-plugin/marketplace.json` version → `1.17.0`.
- `README.md` Latest: line → `v1.17.0 — "Tracker-native Entry"`.
- `/spec-write`, `/implement`, and `/spec-archive` each gained one resolver entry step (step 0a or 0.b′) before any side effect; v1-layout and fallthrough argument paths remain byte-identical.

### Known follow-ups

- **Tier 5 manual walkthrough** (AC-55.1 verify bullet): the live-Linear end-to-end walk documented in the M14 plan is deferred pending a configured Linear workspace — same precedent as M12's Tier 5 deferral documented in the v1.15.0 release. Executing `/spec-write https://linear.app/<workspace>/issue/<real-ticket>/...` against a real workspace remains post-ship verification work.
- CHANGELOG date refresh at merge (this section's date stamp will update to the actual merge day).

### Cross-references

FRs: FR-51..FR-55 (5 FRs, ~32 ACs). NFRs: NFR-17..NFR-21. Design: `technical-spec.md` §9. Test strategy: `testing-spec.md` §8. Total M14 shared-adapter test count: 51 new tests (42 resolve + 9 import); full shared-adapter suite: 155 tests, 0 failures.

## [1.16.0] — 2026-04-21 — "Parallel-safe"

Restructures `specs/` from the monolithic 4-file layout (v1) to a file-per-FR + ULID layout (v2). Introduces a typed `Provider` interface that unifies ID lifecycle and tracker sync behind one contract, so skills never branch on "tracker configured vs. not." Eliminates the three merge-collision classes (ID, content, archival-hotspot) that made parallel-branch spec edits painful under v1. Ships with `/setup --migrate` as the one-way v1 → v2 path, backed by a backup tag, dry-run preview, clean-tree precondition, and two-commit sequence.

**Migration is explicit user invocation only.** Existing v1 projects continue to work unchanged — every spec-touching skill starts with a layout probe that falls through to v1 behavior when `specs/.dpt-layout` is absent. Pattern 9 byte-for-byte regression is preserved across all 3 mode-none baselines.

### Added

- **v2 spec tree** (FR-40 / AC-40.1..5): `specs/frs/<ulid>.md` per FR (active) with `specs/frs/archive/<ulid>.md` (archived), `specs/plan/<M#>.md` per milestone, generated `specs/INDEX.md` (deterministic, sort: milestone ASC → status → ULID ASC), `specs/.dpt-layout` YAML marker.
- **ULID minter** (FR-41 / AC-41.1..5): `adapters/_shared/src/ulid.ts`. `fr_` prefix + Crockford base32 (26 chars, excludes I/L/O/U). Monotonic within-millisecond, random across processes, always local (no network). NODE_ENV=test + DPT_TEST_ULID_SEED produces a deterministic sequence (AC-39.11 discipline). Filename ↔ `id:` frontmatter equality enforced by `/gate-check` conformance probe (NFR-15 invariants 1+2).
- **Provider interface** (FR-42, FR-43 / AC-42.1..5, AC-43.1..6): `adapters/_shared/src/provider.ts` — `mintId/getMetadata/sync/getUrl/claimLock/releaseLock`. Two implementations ship: `LocalProvider` (tracker-less, `.dpt-locks/` + remote scan) and `TrackerProvider` (composes over M12 adapter surface with injectable `AdapterDriver`).
- **Per-milestone plan files + kickoff discipline** (FR-44 / AC-44.1..6): `specs/plan/<M#>.md` with Schema T frontmatter (`milestone, status, kickoff_branch, frozen_at, revision`). Once `status: active`, edits require a sanctioned `plan/<M#>-replan-<N>` branch. `adapters/_shared/src/plan_lock.ts` exports `checkPlanWriteAllowed` + `findPostFreezeEdits` for `/gate-check` probe wiring.
- **Move-based archival** (FR-45 / AC-45.1..6): `/implement` Phase 4 and `/spec-archive` both use `git mv specs/frs/<ulid>.md specs/frs/archive/<ulid>.md` + frontmatter `status` flip in a single atomic commit. Milestone-level archival performs N moves + N flips + plan-file move in one commit.
- **One-ticket-one-branch enforcement** (FR-46 / AC-46.1..7): `Provider.claimLock/releaseLock` at `/implement` entry/exit. Tracker mode strict (status + assignee); tracker-less mode best-effort (`.dpt-locks/` + `git fetch --all` cross-branch scan). `DPT_SKIP_FETCH=1` escape hatch documented.
- **Layout version gate** (FR-47 / AC-47.1..5): `adapters/_shared/src/layout.ts` `readLayoutVersion(specsDir, {allowMissing?})`. `/setup` exempt via `allowMissing: true`. Mismatch → canonical message: `"Layout v<actual> detected; <skill> requires v2. Run /dev-process-toolkit:setup to migrate."`
- **Migration tooling** (FR-48 / AC-48.1..13, NFR-14): `adapters/_shared/src/migrate/{split_fr,colocate,split_plan,convert_archive,index}.ts`. `/setup --migrate` + `--migrate-dry-run` flags. Clean-tree precondition, `dpt-v1-snapshot-<ts>` backup tag, memory-staged transform (all writes computed in RAM before any filesystem mutation), two-commit sequence (`feat(specs): migrate to v2 layout` + `chore(specs): record v2 layout marker`), structured summary (FR count / milestone count / archive count / tag). Idempotent on already-v2 trees. **Recoverability, not strict atomicity**: a failure after the write phase but before commit 2 leaves the working tree in partial-v2 state; users recover via `git reset --hard <backup-tag>`. The backup tag is the always-available rollback path. Graceful degradation for gitignored-specs/ repos (filesystem-only path, no backup tag — that path is for repos where specs/ history is not tracked at all).
- **v2 skill retrofit** (FR-49 / AC-49.1..8): 6 spec-touching skills (`/setup`, `/spec-write`, `/implement`, `/gate-check`, `/spec-archive`, `/spec-review`) gained layout + Provider probes. Read-only skills (`/brainstorm`, `/tdd`, `/simplify`, `/debug`, `/pr`, `/visual-check`) verified layout-agnostic via regression fixture.
- **JSON Schema files** — `adapters/_shared/schemas/{fr,layout,lock,plan,index}.schema.json` (Schemas Q–U as machine-readable JSON Schema; canonical examples live in `technical-spec.md` §8.3).
- **Regression infrastructure** — `tests/fixtures/v2-minimal/` (golden v2 tree), `tests/fixtures/migration/v1-to-v2/{input,expected}/` (round-trip fixture with deterministic ULIDs), Schema M probe layer in `verify-regression.ts` (filename↔id equality, ULID regex, layout marker — AC-49.8).
- **Documentation** (FR-50 / AC-50.1..7): `docs/patterns.md` § Pattern 23 (ULID File-per-FR Layout), `docs/sdd-methodology.md` § Parallel-safe layout, `docs/v2-layout-reference.md` (canonical behavioral contract), `docs/tracker-adapters.md` § Provider Interface, `templates/CLAUDE.md.template` v2 tree description.

### Changed

- `plugin.json` + `.claude-plugin/marketplace.json` version → `1.16.0`.
- `README.md` Latest: line → `v1.16.0 — "Parallel-safe"`.
- Skills' first steps now run a layout probe before tracker-mode probe; v1 path preserved byte-for-byte when `.dpt-layout` is absent (Pattern 9 invariant).

### Spec deviations documented

- **AC-44.2 vs AC-48.7** — migrated active plans have `kickoff_branch: null` + `frozen_at: null` (AC-48.7), while AC-44.2 says those fields are null only for `status: draft`. Resolution: `plan.schema.json` permissive (allOf enforces draft-only null case); migration exception documented in `$comment`. `/gate-check` enforces the tighter AC-44.2 invariant behaviorally for non-migrated plans.
- **AC-49.8 interpretation** — "byte-identical skill outputs against v2-minimal" is structurally validated (Schema M probe: layout marker, ULID regex, filename↔id equality, INDEX.md determinism) rather than by executing each of 12 markdown skills against the fixture. Skills are documentation-style `.md` files, not shell-executable primitives.

### Known follow-ups

- CHANGELOG date refresh at merge (this section's date stamp will update to the actual merge day; AC-50.4 placeholder).
- Regenerated-per-archive `specs/frs/archive/INDEX.md` not shipped (out of scope per technical-spec §8.11).

### Cross-references

FRs: FR-40..FR-50 (11 FRs, 65+ ACs). NFRs: NFR-11..NFR-16. Design: `technical-spec.md` §8. Test strategy: `testing-spec.md` §7.

## [1.15.0] — 2026-04-17 — "Tracker Integration"

Opt-in tracker mode (Linear, Jira, custom) for teams whose ACs live in a task tracker. Default `mode: none` is byte-identical to pre-M12 — Pattern 9 regression gate (`tests/fixtures/baselines/m1-m11-regression.snapshot`) is the stop-ship guardrail.

### Added

- **`## Task Tracking` section in `templates/CLAUDE.md.template` (FR-29 / AC-29.1..5, Schema L)** — Optional block gated behind an HTML comment so `mode: none` renders byte-identical to pre-M12. Section presence = canonical mode probe anchor (see `docs/patterns.md` § Tracker Mode Probe).
- **`plugins/dev-process-toolkit/adapters/` with three adapters (FR-31 / AC-31.1..6, FR-38 / AC-38.1..6):**
  - `_template.md` + `_template/src/stub.ts` — starting point for custom trackers.
  - `linear.md` + `linear/src/normalize.ts` — description-section storage, round-trip idempotence (AC-39.6, AC-37.5), 12 unit tests.
  - `jira.md` + `jira/src/discover_field.ts` — per-tenant custom-field GID discovery against `/rest/api/3/field` fixture (AC-30.6), 6 unit tests.
  - `_shared/src/{classify_diff,sync_log}.ts` — adapter-agnostic FR-39 diff classifier (Schema K) and AC-39.8 sync-log formatter (Schema L), 14 unit tests.
- **`docs/tracker-adapters.md`** — 4-op contract (`pull_acs`, `push_ac_toggle`, `transition_status`, `upsert_ticket_metadata`), Schemas L–P walkthrough, conformance checklist (Tier 5, 35+ items), capability-degradation reference table (FR-38 AC-38.6), Bun-runtime prerequisite section, worked custom-tracker example (FR-38 / AC-38.5).
- **`docs/patterns.md` § Tracker Mode Probe** — the canonical Schema L probe every mode-aware skill runs as its first action.
- **`docs/ticket-binding.md` (FR-32 / AC-32.1..5, Pattern 6)** — 3-tier resolver (branch regex → `active_ticket:` → interactive prompt), mandatory confirmation, conflict handling, URL-paste fallback for custom adapters.
- **`docs/fr-39-sync.md` (FR-39 / AC-39.1..10)** — diff classifier + per-AC prompt (4 options, no bulk shortcuts per AC-39.7) + two-side convergence + sync-log append + cancel semantics + round-trip idempotence.
- **`docs/setup-tracker-mode.md` (FR-30 / AC-30.1..9)** — mode question + Bun check + Linear V1 SSE→V2 migration + `claude mcp list` detection + dry-run `settings.json` diff + test-call verification with hard-stop + Jira per-tenant discovery.
- **`docs/setup-migrate.md` (FR-36 / AC-36.1..8)** — `/setup --migrate` entry point with atomicity guarantee, retry/rollback prompt in NFR-10 canonical shape, and `none→tracker` / `tracker→none` / `<tracker>→<other>` transition procedures.
- **`docs/implement-tracker-mode.md`, `docs/gate-check-tracker-mode.md`, `docs/pr-tracker-mode.md`, `docs/spec-write-tracker-mode.md`, `docs/spec-review-tracker-mode.md`** — per-skill companion docs keeping each skill under NFR-1 (≤300 lines).
- **`tests/fixtures/projects/`** — scenario fixtures (`mode-none-baseline`, `clean-sync`, `tracker-only-ac`, `edited-both`, `tracker-edited-mid-session`, `empty-ac`, `migration-none-to-linear`, `migration-tracker-to-none`, `migration-linear-to-jira`, `migration-atomicity-fail`, `capability-degradation`, `spec-review-tracker-only-ac`) — each documents the expected flow, fail conditions, and AC refs.
- **`tests/fixtures/mcp/{linear,jira}/`** — hand-crafted JSON response fixtures (no recorded PII).
- **`tests/scripts/{capture,verify}-regression.{sh,ts}`** — Pattern 9 byte-diff gate against `tests/fixtures/baselines/m1-m11-regression.snapshot`.

### Changed

- **Mode-aware probe wired into seven skills** (`/setup`, `/spec-write`, `/implement`, `/gate-check`, `/pr`, `/spec-review`, `/spec-archive`). Absence of `## Task Tracking` ≡ `mode: none` per AC-29.5; the tracker-mode branches are literally unreachable on the pre-M12 path (Pattern 9).
- **`skills/setup/SKILL.md`** — +`0. Tracker mode probe` for existing projects, +`0b. --migrate` invocation routing, +`7b. Tracker mode` opt-in question near end of flow (default `none`, skippable). 228 lines (≤300).
- **`skills/implement/SKILL.md`** — Phase 1 step 0 gains ticket-binding + `updatedAt` recording + FR-39 diff/resolve in tracker mode. 279 lines (≤300).
- **`skills/gate-check/SKILL.md`** — Tracker Mode Probe header adds `updatedAt` re-check with AC-39.10 two-option warning and `push_ac_toggle` on gate pass. 131 lines.
- **`skills/pr/SKILL.md`** — Tracker Mode Probe header adds `transition_status(in_review)` + optional `upsert_ticket_metadata` for PR URL (NFR-8 ≤2 MCP calls).
- **`skills/spec-write/SKILL.md`** — step 0 adds ticket-binding + post-save FR-39 diff/resolve before `upsert_ticket_metadata` (AC-34.7, AC-39.9).
- **`skills/spec-review/SKILL.md`** — step 0 pulls ACs via active adapter's `pull_acs` in tracker mode; `mode: none` reads local `specs/requirements.md` as before.
- **`skills/spec-archive/SKILL.md`** — step 0 clarifies that tracker-ticket archival is out of scope; archival still operates on local `specs/` content only.

### Fixed

- `/gate-check` tracker-mode branch explicitly does **not** run full FR-39 resolution (AC-39.10) — it only warns on `updatedAt` mismatch with a two-option response. This prevents bidirectional writes from sneaking into gate checks, which are supposed to be read-mostly.
- **Pre-migration on-disk backup** for `<tracker> → none` and `<tracker> → <other tracker>` migrations (`docs/setup-migrate.md` § Pre-migration on-disk backup). Both paths copy `CLAUDE.md` and `specs/requirements.md` to timestamped `*.pre-migrate-backup-<ISO>` files **before any local mutation**. Defense-in-depth for the FR-39 reconciliation phases: if a partial failure or unwanted merge corrupts local source-of-truth, the operator restores with `mv`. `none → <tracker>` skips the backup (path doesn't write locally until success). Failed `cp` hard-stops migration. Backups are not auto-deleted; sort lexically by ISO timestamp so re-runs never overwrite earlier backups.

### Pattern 9 regression

- `diff <regression-output> tests/fixtures/baselines/m1-m11-regression.snapshot` is empty. `mode: none` output byte-identical to pre-M12 baseline. Stop-ship gate passed.
- **Coverage widened** post-review: `verify-regression.sh` now iterates over three real-shape fixtures — `mode-none-baseline` (Node/TypeScript, original), `mode-none-flutter` (Dart/Flutter), and `mode-none-archived` (Python/FastAPI with archive content that deliberately quotes the `## Task Tracking` heading to prove the Schema L probe only reads `CLAUDE.md`). All three byte-identical to baseline.
- **Probe-wording parity gate** added (`tests/probe-parity.test.ts`, 15 tests): all 7 mode-aware skills must reference the canonical `Schema L probe (see docs/patterns.md § Tracker Mode Probe)` anchor, and the 6 non-`setup` skills must carry the verbatim `mode: none` no-op guard sentence. Catches silent drift if a future edit "improves" the probe in one skill but forgets the others.

### FRs covered

FR-29, FR-30, FR-31, FR-32, FR-33, FR-34, FR-35, FR-36, FR-37, FR-38, FR-39 (11 FRs, 80+ ACs). NFR-1 (size cap) holds for all modified skills. NFR-7 (adapter source ≤500 lines) holds for all helpers. NFR-10 (canonical error shape) applied consistently across AC-30.5, AC-33.4, AC-34.5, AC-35.4, AC-36.7, AC-38.6.

### Known limitations at ship

- **Tier 5 manual conformance** shipped as documented checklist; **not executed** against live Linear / Jira at v1.15.0. MCP tool names in each adapter are marked "provisional (Phase H conformance)" — they follow each tracker's public MCP documentation but have not been verified via authenticated `tools/list` introspection. First operator to authenticate against live MCPs should lock the names.
- Skill file sizes for companion-doc extraction (`docs/*-tracker-mode.md`) chosen conservatively to leave buffer under NFR-1.

## [1.14.1] — 2026-04-14 — "Drift Catcher"

### Fixed

- **`README.md` "Latest:" line refreshed to v1.14.0 "Single File"** — The release line had been left at v1.13.0 "Second Look" during the v1.14.0 bump, advertising the wrong release to new users on the main entry point.
- **`README.md` pattern count corrected from 14 to 22** — The Structure list claimed `docs/patterns.md` held "14 proven patterns"; the file has carried 22 numbered patterns since v1.12.x. Count had drifted silently across multiple releases.

### Changed

- **`CLAUDE.md` Release Checklist promoted from 3 files to 4** — `README.md` added as item #4, with explicit guidance to refresh the "Latest:" line and any counts in the Structure list that the release changed (skill count, pattern count, etc.). Trailing "All three must stay in sync" updated to "All four." Prevents the two drift patterns caught this release from recurring.

### Motivation

Two audit passes on v1.14.0 surfaced that the README had been silently drifting across releases: the "Latest:" line was one version stale, and the `patterns.md` count was 8 patterns behind reality. Root cause: the Release Checklist in `CLAUDE.md` only listed three files, so `README.md` was never on the sync-at-release list. This patch fixes the stale facts and adds the guardrail so future bumps can't miss the README.

## [1.14.0] — 2026-04-13 — "Single File"

### Added

- **Canonical one-at-a-time sentence in `brainstorm/SKILL.md` and `spec-write/SKILL.md` Rules (FR-28 / AC-28.1, AC-28.4, AC-28.5)** — Both skills now carry the byte-identical sentence `Ask one clarifying question per turn. Wait for the answer before asking the next. This rule holds at phase transitions too — when two questions look independent, still ask the first, wait, then ask the second.` as a Rules bullet. Treated as a cross-skill schema (NFR-4 precedent): a Tier 1 `diff` check catches drift on future edits.
- **`### Rationalization Prevention` subsection in `brainstorm/SKILL.md` (FR-28 / AC-28.2)** — New 2-column table (`Excuse` | `Reality`) with 4 rows targeting the specific excuses observed in the v1.13.0-session violation: "These two questions are independent" / "Ask the first, wait, then the second"; "Efficiency wins — batch them" / "Efficiency ≠ batching; the socratic form is the gate"; "The user is responsive, I'll batch" / "Responsiveness is not license to batch"; "We're at the handoff, last chance" / "Phase transitions are where batching happens most — same rule applies". Mirrors the pattern shipped by FR-24 in `/gate-check`.

### Changed

- **Per-section question blocks in `spec-write/SKILL.md` (FR-28 / AC-28.3, AC-28.7)** — The 4 blocks under `#### requirements.md`, `#### technical-spec.md`, `#### testing-spec.md`, `#### plan.md` reshaped from bulleted simultaneous-question lists to explicit ordered-waiting prose ("Ask {Q1}. Wait for the answer. Then ask {Q2}."). Same questions, same steps — only framing changed. No heading renames, no removed steps, no new required user-facing questions.

### Motivation

At the tail of the v1.13.0 session, Claude batched two independent scope-lock questions at the `/brainstorm` → `/spec-write` handoff despite both skills' explicit one-question-at-a-time rule. The rule was documented but not followed rigorously at phase transitions, and `/spec-write`'s bulleted per-section question blocks implicitly encouraged the same batching. This release tightens the wording in both skill files (where downstream-project memory cannot reach) and reshapes `/spec-write`'s structure so the socratic form is visible in the skill body itself. The Rationalization Prevention table targets the three rationalizations observed in-session ("these are independent", "efficiency", "responsive user") plus the phase-transition trap explicitly. Both skills remain well under the NFR-1 300-line budget (`brainstorm` 69, `spec-write` 146).

## [1.13.0] — 2026-04-13 — "Second Look"

### Added

- **Two-pass `/implement` Phase 3 Stage B (FR-23 / AC-23.1..23.8)** — Stage B now delegates to `code-reviewer` **twice in sequence** via the `Agent` tool. **Pass 1 — Spec Compliance** (gated on `specs/requirements.md` existing; silently skipped when `specs/` is absent) asks the subagent whether every change in the diff traces to an AC and flags any undocumented behavior. **Pass 2 — Code Quality** runs only if Pass 1 returned `OVERALL: OK` or Pass 1 was skipped, and applies the canonical 5-criterion rubric. The literal fail-fast rule `If Pass 1 returns critical findings, do NOT run Pass 2; surface Pass 1 findings and stop.` is in the skill body verbatim. Skipped Pass 2 is reported as the literal line `Pass 2: Skipped (Pass 1 critical findings)` under a `### Pass 2: Code Quality` subheading — never silently omitted. `implement/SKILL.md` grew from 238 → 274 lines (still 26 under NFR-1).
- **`### Pass-Specific Return Contracts` in `agents/code-reviewer.md` (FR-23 / AC-23.6)** — New subsection documents the two prompt shapes. Pass 1 returns one `AC-X.Y — OK|CONCERN` line per AC plus one catch-all `Undocumented behavior` line; Pass 2 returns one line per rubric criterion. Both end with `OVERALL: OK` or `OVERALL: CONCERNS (N)` — the existing Schema J shape, reused unchanged at the line level.
- **`### Rationalization Prevention` table in `gate-check/SKILL.md` Red Flags (FR-24 / AC-24.1..24.4)** — Two-column table (`Excuse` | `Reality`) borrowed from the `superpowers` plugin with the 6 canonical rows (`Should work now` / `Run the verification`, `I'm confident` / `Confidence ≠ evidence`, `Just this once` / `No exceptions`, `Linter passed` / `Linter ≠ compiler / tests`, `Agent said success` / `Verify independently`, `Partial check is enough` / `Partial proves nothing`) in that order. No verdict strings changed (NFR-4 preserved).
- **`plugins/dev-process-toolkit/docs/parallel-execution.md` (FR-25 / AC-25.1..25.8)** — New 75-line advisory doc (budget ≤200) covering `## Native Subagents` (links `https://code.claude.com/docs/en/sub-agents`), `## Agent-Teams` (links `https://code.claude.com/docs/en/agent-teams`), and `## Worktree-per-Subagent Isolation`. The top-of-file **Advisory only** disclaimer makes the opt-in framing explicit. The worktree section documents merge-back via `/implement`'s existing recovery options and file-partitioning for conflict avoidance.
- **`## Parallelization` subsection in `implement/SKILL.md` (FR-25 / AC-25.6)** — Placed immediately before `## Phase 3` (not buried in Phase 2 prose) with the literal pointer line `For parallelizable work, see docs/parallel-execution.md before dispatching.` Ensures the new doc is consulted on every `/implement` run instead of becoming dead weight.
- **`### Task Sizing` in `templates/spec-templates/plan.md.template` (FR-26 / AC-26.1..26.3)** — Tasks now render as 2-line entries (`- [ ] Action` + indented `verify:` line). New sizing note carries the literal `Each task should be ≈ one commit's worth of work — small enough that the verification step is unambiguous`. Anti-pattern callout lists three bad task shapes (`Implement entire feature`, `Refactor and add tests and update docs`, `Clean up technical debt`) each with a one-line reason.
- **`Task Sizing` reference in `spec-write/SKILL.md` (FR-26 / AC-26.4)** — `plan.md` step now instructs `/spec-write` to generate tasks conforming to the template's 2-line shape and points back at the template for the anti-pattern callout.

### Changed

- **`disable-model-invocation: true` dropped from `/implement` and `/pr` (FR-27 / AC-27.1..27.6)** — The flag was a leaky workaround blocking legitimate composition from agent-teams subagents (a subagent could not invoke `/implement` via the `Skill` tool and had to read `SKILL.md` body manually). Flag is retained on `/setup` only (bootstrap skill — a subagent re-running `/setup` mid-flight would clobber the working tree). `docs/skill-anatomy.md` Best Practices narrowed to recommend the flag only for bootstrap-style skills.
- **`docs/skill-anatomy.md` § Subagent Execution** — Gained a brief "Sequential multi-pass variant" note pointing at the Stage B two-pass template as the canonical example of stacking the `Agent`-tool primitive.
- **Root `CLAUDE.md` agent line** — Updated to describe `code-reviewer` as "invoked twice by /implement Stage B: Pass 1 spec-compliance, Pass 2 code-quality".
- **`README.md`** — `/implement` row describes the two-pass Stage B; `code-reviewer` agent bullet enumerates the pass-specific return contracts; Latest-release pointer updated to v1.13.0.

### Motivation

The single Stage B review from v1.12.0 conflated "did we build the right thing" (spec compliance) with "did we build it well" (code quality), leaving the subagent with no way to escalate a wrong-feature finding over a minor style nit. Splitting Pass 1 and Pass 2 with fail-fast between them makes the cheaper gate (spec compliance) the one that runs first and stops the review early when the change is fundamentally wrong. The rationalization-prevention table in `/gate-check` is the cheap deterrent against "should work now" / "I'm confident" / "linter passed" reasoning — same cost as a single bullet list, roughly one order of magnitude higher salience. `docs/parallel-execution.md` closes the documentation gap for the worktree + subagents + agent-teams patterns the toolkit already relies on (M10 itself was implemented under a team-lead + implementer pair inside a worktree) without pushing implementation-pattern prose into the ~270-line `implement/SKILL.md`. The `plan.md.template` tightening is the lesson from prior milestones where "Task 1 — Implement entire feature" showed up and there was no obvious verification step to gate on.

### Dogfood validation

Task 12 of M10 ran `/implement` on M10 itself end-to-end through the new two-pass Stage B. Pass 1 and Pass 2 both fired on the M10 change set and returned `OVERALL: OK`; a synthetic spec-drift variant (adding an undocumented function) was reasoned through to confirm Pass 2 is reported as `Pass 2: Skipped (Pass 1 critical findings)` on fail-fast, per AC-23.5. All four FRs passed Tier 1 static verification and Tier 2 behavioral scenarios.

## [1.12.0] — 2026-04-11 — "Dead Branches"

### Added

- **`/implement` Phase 3 Stage B now delegates to `code-reviewer` via explicit `Agent`-tool invocation (FR-22 / AC-22.2)** — Stage B is no longer an inline rubric copy. The skill spells out the exact prompt template (changed files from `git diff --name-status <base-ref>`, Phase 1 AC checklist as context, stack hints from CLAUDE.md, explicit instruction to **not** check spec compliance), the expected return shape (`<criterion> — OK` / `<criterion> — CONCERN: file:line — <reason>`, ending with `OVERALL: OK` or `OVERALL: CONCERNS (N)`), and the Stage B pass/fail integration logic including an inline-fallback path if the subagent errors or returns an unparseable shape.
- **`docs/skill-anatomy.md` gains a concrete `Agent`-tool delegation example (AC-22.8)** — The Subagent Execution section now leads with a copy-pasteable example adapted from `/implement` Phase 3 Stage B as the reference implementation. The existing abstract `context: fork` example is retained but explicitly labeled "Alternative — unexercised in this plugin as of v1.12.0" since 0 of 12 skills use that frontmatter.
- **`docs/implement-reference.md` gains a Milestone Archival Procedure section** — Sub-steps a–i (archive target resolution, collapse rule, write-then-delete ordering, incomplete-matrix fallback) moved here from the skill body to free up line budget for the new delegation block while keeping the procedure fully documented.

### Changed

- **`agents/code-reviewer.md` is now the canonical review rubric for the plugin (AC-22.3, AC-22.5)** — Stack-specific review checklist (Flutter / React / MCP / API) moved here from `implement/SKILL.md` Stage B. The old Spec Compliance section is deleted — `/spec-review` remains the sole canonical home for AC→code traceability, and `code-reviewer` now covers quality, security, patterns, and stack-specific only. The agent file documents its exact return shape at the bottom so callers can parse findings deterministically.
- **`gate-check/SKILL.md` Code Review section points at `agents/code-reviewer.md` as its rubric source (AC-22.4)** — Gate-check continues to run the review **inline** (synchronous, no delegation) because a gate verdict must return in one turn. Only the rubric source is unified, not the execution path.
- **`simplify/SKILL.md` wording aligned with `code-reviewer.md` where they overlap (AC-22.6)** — Simplify is not converted to delegation; its scope (reuse / quality / efficiency cleanup) remains distinct. Where criteria overlap (naming, hardcoded values, pattern compliance), simplify now explicitly defers to the code-reviewer rubric to prevent contradictory guidance.
- **`docs/adaptation-guide.md` Step 6 rewritten (AC-22.7)** — The stale `test-writer` and `debugger` bullets are gone; `code-reviewer` is described as the canonical review agent with `/implement` Phase 3 Stage B as the reference delegation point and a link to the `docs/skill-anatomy.md` example.
- **`plugins/dev-process-toolkit/skills/implement/SKILL.md` shrunk from 276 → 238 lines (AC-22.9)** — 38-line reduction buffers NFR-1 (300-line skill cap) for future Phase 3 additions. Achieved by compressing Pre-flight + Partial Failure Recovery, moving the Milestone Archival sub-steps to `implement-reference.md`, and delegating the Stage B rubric body to `code-reviewer.md`.
- **Skill and agent count across `CLAUDE.md` and `README.md`** updated to reflect the single remaining agent.

### Removed

- **`plugins/dev-process-toolkit/agents/test-writer.md` deleted (AC-22.1)** — Orphaned since inception: zero skill invocation sites, weaker duplicate of `/tdd` (RED → GREEN → VERIFY with shallow-assertion anti-patterns). `rg 'test-writer' plugins/` now returns zero matches (CHANGELOG.md is the only remaining reference).
- **Spec Compliance section in `agents/code-reviewer.md`** — Deleted outright (not relocated). `/spec-review` was already the canonical home for AC→code traceability, and `code-reviewer` now covers quality, security, patterns, and stack-specific only.

### Motivation

A plugin audit on 2026-04-11 turned up two dead subagents (`code-reviewer` and `test-writer`) with zero invocation sites since the plugin's inception, plus duplicate review-rubric logic spread across four files (`gate-check`, `implement` Phase 3 Stage B, `simplify`, `code-reviewer.md`). `docs/skill-anatomy.md` documented `context: fork` + custom-agent delegation, but 0 of 12 skills exercised it — an advertised pattern that had never been road-tested. Meanwhile `implement/SKILL.md` sat at 276/300 against NFR-1 and its Stage B inlined ~60 lines of review rubric that would benefit from context-isolated delegation. v1.12.0 picks the boring, known-to-work path (explicit `Agent`-tool invocation from inside the skill body) rather than the unexercised `context: fork` alternative, gives `code-reviewer` a real delegation point so it stops being dead code, deletes `test-writer` so the plugin stops advertising an entry point that doesn't exist, and consolidates the review rubric into a single canonical home.

### Dogfood validation

As part of task 11 in M9, `/implement` was run against M9 itself and the new Stage B delegation was used to spawn `code-reviewer` on the in-flight change set. The subagent returned findings in the exact `OVERALL: CONCERNS (N)` shape the Stage B integration logic parses, caught legitimate issues (stale `test-writer` references in `CLAUDE.md` and `README.md`, an unresolved `<base-ref>` placeholder in the Stage B prompt template, skill-anatomy example missing an exclusion clause), and proved the delegation pattern is round-trip-executable by a fresh Claude instance reading the skill cold. All findings were resolved before the version bump.

## [1.11.0] — 2026-04-10 — "Residue Scan"

### Added

- **Post-archive drift check (FR-21)** — Every archival operation (both `/spec-archive` and `/implement` Phase 4 auto-archival) now runs a two-pass drift check and emits a unified Schema I advisory report. **Pass A** greps live spec files for orphan `M{N}` / `FR-{N}` / `AC-{N}.` token references that survived the archival (severity `high`). **Pass B** has Claude re-read each live spec with a bounded brief — just-archived IDs plus a one-paragraph title+goal excerpt of each new archive file — to flag scope-limiting narrative that assumes the archived milestones were the whole project (severity `medium`).
- **3-choice UX, never blocks archival** — When the drift report is non-empty, the user picks between addressing flags inline (with per-edit approval), saving the report to `specs/drift-{YYYY-MM-DD}.md` for later, or acknowledging and continuing. Empty reports emit the literal `No drift detected` and continue silently. The archival operation itself is never blocked by drift findings, and Pass B never auto-edits narrative.
- **`docs/patterns.md` — `### Pattern: Post-Archive Drift Check`** — Documents the two-pass rationale, the Flutter dogfood canary example verbatim, why Pass B is load-bearing despite its false-positive rate, and the accuracy-first tradeoff decision from the brainstorm session.

### Motivation

The v1.10.0 dogfood run on a Flutter project surfaced the residue problem: archiving M1–M4 (documentation milestones) cleanly moved the blocks and ACs, but left `requirements.md` Overview calling the project a "layered documentation set" and Out-of-Scope saying "Code changes — documentation only" while M5 (a code milestone) was in flight. Pure grep missed it — the phrasing uses no literal `M{N}` tokens — and a manual four-file consistency pass after every archival was the cost. FR-21 makes that scan automatic and advisory, keeping the archival flow fast and the live specs honest.

## [1.10.0] — 2026-04-09 — "Bounded Context"

### Added

- **Auto-archival in `/implement` Phase 4 (FR-16)** — When a milestone ships and the human approves the Phase 4 report, the milestone block and its traceability-matched ACs move automatically out of `plan.md` / `requirements.md` into `specs/archive/M{N}-{slug}.md`, leaving blockquote pointer lines in place. Live spec files stay size-bounded regardless of project age; hot-path token cost stays roughly constant.
- **`/spec-archive` escape-hatch skill (FR-17)** — Manual archival for any user-selected milestone, FR, or AC block, with an explicit diff approval gate. Covers reopens, cross-cutting ACs, and anything auto-archival can't reach. Reopened milestones produce `-r2` / `-r3` revision files; the archive is append-only.
- **Stable anchor IDs on spec headings (FR-18)** — `{#M{N}}` and `{#FR-{N}}` anchors are now baked into the spec templates and enforced by `/spec-write` and the `/setup` doctor check. Archival pointers survive heading renames and reorders.
- **`specs/archive/` directory convention and rolling index (FR-19)** — `/setup` scaffolds `specs/archive/index.md` from day one. `/implement` and `/gate-check` never read the archive; `/spec-review` may consult the index on explicit historical queries.
- **Documentation, README, and project CLAUDE.md coverage (FR-20)** — `docs/patterns.md` gains an Archival Lifecycle pattern; `docs/sdd-methodology.md` documents compactable specs; `docs/adaptation-guide.md` gains a `## Customizing Archival` section; README lists the 12th skill and links here; project CLAUDE.md updates skill count.
- **`CHANGELOG.md`** (this file) — Single place for release notes; replaces the previous "What's new" block in README.

### Changed

- Skill count: **11 → 12** (added `/spec-archive`).
- `plugins/dev-process-toolkit/skills/implement/SKILL.md` Phase 3 Stage C hardening examples extracted to `plugins/dev-process-toolkit/docs/implement-reference.md` to stay under NFR-1's 300-line cap. Final size: 272 lines.
- Release checklist in `CLAUDE.md` now includes a mandatory CHANGELOG.md update step.

### Dogfood validation

As part of the M7 milestone, the shipped v1.8/v1.9 content (M1–M6 in `specs/plan.md` and FR-1..FR-15 in `specs/requirements.md`) was retroactively compacted into `specs/archive/` using the new `/spec-archive` skill. This both validates the feature end-to-end and proves NFR-5:

- `specs/plan.md`: **374 → 139 lines (−63%)**
- `specs/requirements.md`: **440 → 218 lines (−50%)**
- 6 Schema G archive files created (one per shipped milestone) plus `specs/archive/index.md`.

### Opt out

Delete `specs/archive/` — the auto-path skips silently when the directory is absent. See `plugins/dev-process-toolkit/docs/adaptation-guide.md` § *Customizing Archival* for the full opt-out and manual-archival recipe.

## [1.9.0] — 2026-04-07 — M6: ADAPT Marker Cleanup

### Removed

- Manual setup path from docs and README — plugins run from the marketplace directory, users never edit skill files directly.
- `<!-- ADAPT -->` markers in `skills/**` and `agents/**` (converted to plain-text runtime LLM instructions that reference the project CLAUDE.md).

### Changed

- `docs/adaptation-guide.md` reframed as a "customize after `/setup`" reference rather than a manual-setup guide.
- Template `<!-- ADAPT -->` markers preserved (unchanged — templates are copied into user projects where manual edits are expected).

## [1.8.0] — 2026-04-07 — "Depth over Breadth"

### Added

- Drift detection in `/gate-check` and `/implement` Phase 4 (FR-1).
- Security scanning guidance in `/gate-check` Commands section (FR-2).
- CI/CD parity: structured JSON output from `/gate-check` plus starter GitHub Actions configs for TypeScript/Python/Flutter (FR-3).
- Doctor validation in `/setup` — checks tools, gate commands, CLAUDE.md, settings.json (FR-4).
- Spec deviation auto-extraction in `/implement` Phase 4 (FR-5).
- Spec breakout protocol in `/implement` (FR-6) — stop when ≥3 `contradicts`/`infeasible` deviations accumulate in one milestone.
- Spec-to-code traceability map in `/spec-review` (FR-7).
- Shallow test detection in `/tdd` and `/implement` (FR-8).
- Visual-check MCP fallback with manual verification checklist (FR-9).
- Structured risk scan in `/spec-write` with explicit categories + 3-tier severity (FR-10).
- Code-reviewer agent spec compliance section (FR-11).
- Worktree partial failure recovery in `/implement` (FR-12).
- Golden path workflows (Bugfix / Feature / Refactor) in CLAUDE.md template + `/setup` report (FR-13).
- Enhanced spec templates with security/abuse cases, measurable NFRs, negative ACs, ADR tables (FR-14).
- 6 cross-skill schemas (A–F) documented in `technical-spec.md` and enforced in NFR-4.

### Notes

- NFR-1 skill size cap: 300 lines per skill file with an overflow rule extracting long content to `docs/<skill-name>-reference.md`.

## [1.7.0] and earlier

See `git log --oneline` for the full history. Notable earlier releases:

- **v1.7.0** — Phase 3 hardening stage in `/implement`; spec deviation handling; 5 new patterns.
- **v1.6.0** — Added `/debug` and `/brainstorm` skills plus 6 process improvements.
- **v1.5.0** — Spec cross-check consistency step in `/spec-write`.
- **v1.4.x** — Initial marketplace metadata, MCP server config, bug-fix passes from real-world testing.
