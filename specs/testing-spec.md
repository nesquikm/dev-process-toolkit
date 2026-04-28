# Testing Specification

## 1. Test Framework

The plugin ships Markdown prompt files plus TypeScript helpers invoked via `bun run`. "Testing" is structured across five tiers:

- **Tier 1 — Static Verification:** file-inspection checks (grep, `wc -l`, frontmatter parse) against literal strings and structural invariants.
- **Tier 2 — Behavioral Validation:** before/after assertions on a reference project — run the skill, observe the output/tree.
- **Tier 3 — Regression:** core-workflow end-to-end against golden fixtures (`tests/fixtures/`) — any diff against captured snapshots is stop-ship.
- **Tier 4 — Unit Tests (Bun):** `bun test` over `adapters/_shared/src/**/*.test.ts`, `adapters/<tracker>/src/**/*.test.ts`, and `plugins/dev-process-toolkit/tests/*.test.ts`. Pure functions only; no network.
- **Tier 5 — Manual Conformance:** adapter end-to-end checklists documented in `docs/tracker-adapters.md`. Run once per shipped adapter against a real tracker instance. No automated harness — test accounts + OAuth + teardown are out of scope.

Runner: Tier 4 uses `bun test`. Tiers 1–3 are structured manual verification. Mocking: hand-crafted JSON fixtures under `plugins/dev-process-toolkit/tests/fixtures/`; no recorded/replayed MCP responses (review risk + PII risk).

## 2. Test Strategy

### Tier 1 — Static Verification (generic patterns)

Apply per changed file:

| Check | Method | Pass Criterion |
|-------|--------|---------------|
| Markdown syntax | Render; validate tables/code blocks | No broken structure |
| Section headings | Grep for expected titles referenced by ACs | Every referenced heading exists |
| Internal references | Grep for skill names, file paths, schema anchors | Every referenced file/skill/anchor exists |
| `<!-- ADAPT -->` markers | Grep `skills/**`, `agents/**` for `<!-- ADAPT` | Zero matches (AC-15.3) |
| Line count | `wc -l` per SKILL.md | Every skill ≤ 300 lines (NFR-1) |
| Frontmatter | YAML parse | Valid `name`, `description`, `argument-hint` fields |
| Cross-skill schemas | Diff byte-for-byte between skills owning the same schema | NFR-4 — schemas match across files |
| Verdict strings | Grep `GATE PASSED`, `GATE PASSED WITH NOTES`, `GATE FAILED` in `/gate-check` | All three exact strings present; no variants |
| Stable anchor IDs | Grep `{#M` / `{#FR-` in plan + requirements templates | Template anchor format present |
| Per-milestone heading drift (FR-63 AC-63.6) | Grep `^#{1,3} M\d+` in `specs/technical-spec.md` + `specs/testing-spec.md` | Zero matches |
| v1 archive path drift (FR-70 AC-70.1) | Grep the v1-archive literal path in `plugins/dev-process-toolkit/docs`, `plugins/dev-process-toolkit/skills`, `README.md`, and live cross-cutting specs | Zero matches outside fixtures, CHANGELOG, and the v2 archive directories |

### Tier 2 — Behavioral Validation (generic patterns)

For every FR that adds or modifies observable skill behavior: craft an input scenario, capture the before/after output on the reference stack, assert the difference matches the AC. Canonical shapes:

- **Entry-gate probes** — run the skill in both layout versions, both tracker modes; assert mode-none byte-identical to pre-change baseline, tracker-mode surfaces the new behavior.
- **Pass/fail boundary tests** — craft minimal fixtures that exercise each pass/fail branch of a gate; assert the verdict string from Schema F.
- **Error-path probes** — inject the failure mode (missing file, malformed YAML, MCP disconnected); assert the NFR-10 canonical error shape.
- **Idempotency probes** — run the skill twice; second run is a no-op (e.g., already-migrated tree, already-archived FR).

Per-FR scenarios live in each FR's `## Testing` section (`specs/frs/<ulid>.md`). Tier 2 entries here are strategy templates, not a per-FR catalog.

### Tier 3 — Regression (core-workflow)

After any skill change, run the full workflow on the reference fixture set and byte-compare against captured snapshots:

| Workflow | Fixture | Snapshot |
|----------|---------|----------|
| `/setup` on fresh TypeScript project | `tests/fixtures/projects/fresh-ts/` | `…/snapshots/setup.snap` |
| `/spec-write` end-to-end | `tests/fixtures/projects/fresh-ts/` | `…/snapshots/spec-write.snap` |
| `/implement` on a simple milestone | `tests/fixtures/projects/simple-milestone/` | `…/snapshots/implement.snap` |
| `/gate-check` on clean + dirty trees | `tests/fixtures/projects/*` | `…/snapshots/gate-check.snap` |
| `/spec-archive` | `tests/fixtures/projects/archivable/` | `…/snapshots/spec-archive.snap` |
| `/setup --migrate` v1 → v2 | `tests/fixtures/migration/v1-to-v2/input/` | `tests/fixtures/migration/v1-to-v2/expected/` |
| v2-minimal regression (all 12 skills) | `tests/fixtures/v2-minimal/` | `…/snapshots/<skill>.snap` |
| `mode: none` byte-for-byte regression | `tests/fixtures/mode-none-regression/` | `…/baselines/m1-m11-regression.snapshot` |

Any diff against snapshot → stop-ship.

### Tier 4 — Unit Tests (Bun)

Location: co-located with source (`adapters/_shared/src/*.test.ts`, `adapters/<tracker>/src/*.test.ts`, `plugins/dev-process-toolkit/tests/*.test.ts`).

Module coverage (all behaviors, 100% branch coverage per NFR-21):

- **`ulid.ts`** — format regex, uniqueness loop, parallel-process simulation, collision-retry.
- **`provider.ts` + `local_provider.ts` + `tracker_provider.ts`** — `mintId`, `sync`, `claimLock` (fresh/held-local/held-remote), `releaseLock` (including idempotent release), `getTicketStatus`.
- **`resolve.ts`** — ULID detection, URL detection (happy + unknown host + malformed), tracker-ID detection (unambiguous + ambiguous + prefix disambiguation), explicit prefix form, fallthrough, ordering invariant, mutation probes.
- **`import.ts`** — happy path + empty-AC TODO marker + error paths + ordering guarantees.
- **`resolver_config.ts`** — Schema W loader; `MalformedAdapterMetadataError` surfaces per NFR-10.
- **`adapters/<tracker>/src/*.ts` helpers** — round-trip idempotence (`normalize(normalize(x)) === normalize(x)`); Jira field discovery.
- **`docs_config.ts`** — Schema X reader; missing-section defaults, malformed-value NFR-10 refusal, key parse order.
- **`docs_layout.ts`** — `ensureCanonicalLayout` idempotence (safe on re-run); per-mode fill; mixed-mode merge (shared `tutorials/` + `explanation/`, split `reference/`).
- **`docs_nav_contract.ts`** — four-anchor validation, missing-anchor and broken-link failure shapes.
- **`impact_set.ts`** — Schema Y extractor; per-category fixtures (added public function, modified signature, added CLI command, package.json key, enum value); determinism probe (same diff → same struct).
- **`signature_extractor.ts`** — Schema Z extractor across three strategies (typedoc mocked subprocess, ts-morph real parser, regex fallback); post-generation validator (reject LLM output with invented signatures; single-retry bound).
- **`setup/audit_log.ts`** (STE-108) — `appendAuditEntry` create-section / append-entry / idempotent-append behaviors; file-missing failure mode; preserved trailing-newline shape.
- **`setup/merge_settings.ts`** (STE-106) — `canonicalAllowList` per-stack lookup + dedup + unknown-stack throw; `mergeAllowList` preserves user additions, dedups canonical, handles missing `permissions`/`allow` keys, preserves `deny` and other root keys.
- **`spec_archive/rewrite_links.ts`** (STE-111) — Markdown link forms (`](frs/X.md)`, `](./frs/X.md)`, bare path) covered; CHANGELOG scoping (above first dated `## [X.Y.Z]` only); orphan-FR no-op; archive-already-references no-op.
- **`scripts/migrate-task-tracking-canonical.ts`** (STE-114) — `computeMigrationDiff` clean-input idempotence; drifted-input rewrite emitting `### <Tracker>` subsection; existing-subsection append (no duplicate heading); LCS-based unified-diff stability.

`/setup` hardening probes (Tier 4 integration tests; STE-82 contract):

- `tests/gate-check-setup-output-completeness.test.ts` (STE-106 probe #17)
- `tests/gate-check-claudemd-docs-section.test.ts` (STE-107 probe #18)
- `tests/gate-check-setup-audit-section-presence.test.ts` (STE-108 probe #19)
- `tests/gate-check-bun-zero-match-placeholder.test.ts` (STE-113 probe #20)
- `tests/gate-check-task-tracking-canonical-keys.test.ts` (STE-114 probe #21)
- `tests/gate-check-setup-bootstrap-committed.test.ts` (STE-109 probe #22)
- `tests/gate-check-traceability-link-validity.test.ts` (STE-111 probe #23)
- `tests/gate-check-identity-mode-conditional.test.ts` extended for STE-110 severity flip (warn → error).

Determinism helpers: `DPT_TEST_ULID_SEED` (deterministic ULID sequence for migration expected outputs), `DPT_TEST_FROZEN_TIME` (freezes timestamps used by INDEX, plan frontmatter, lock files, sync-log entries). Both are gated on `NODE_ENV === 'test'`.

### Tier 5 — Manual Conformance (per shipped adapter)

`docs/tracker-adapters.md` ships a checklist per adapter (Linear, Jira). Checklist items include: create test ticket; exercise each 4-op; toggle AC via `/gate-check`; edit tracker-side and run `/implement` to verify FR-39 diff surfaces; migrate between modes. Expected results are documented per step with explicit pass/fail criteria. Contributed adapters carry the contributor's responsibility to attach a passed checklist in their PR.

## 3. Conventions

### What to Test

- Every AC has a Tier 1 static check AND a Tier 2 behavioral scenario (or a Tier 4 unit test if the AC names a function or module).
- Cross-cutting schemas (A–W) are verified at every skill that produces or consumes them.
- Regressions cover the core workflow: setup → spec-write → implement → gate-check → spec-archive → migration.
- Tracker-mode FRs are exercised against MCP fixtures, never live trackers (Tier 4/5 boundary).

### What NOT to Test

- Exact LLM output phrasing (non-deterministic — test section presence, not wording).
- Template placeholder text (replaced by users).
- Third-party tool behavior (`npm audit` formats, GitHub Actions runners, Linear's UI rendering).
- MCP server internals — only detection/fallback paths.
- Live tracker API under real traffic (Tier 5 manual only).
- Live OAuth flows (delegated to tracker MCPs per NFR-9).
- Helper binary startup latency (NFR-6 covers end-to-end skill-call latency at runtime, not process-level perf).
- Cross-platform `git` behavior beyond macOS / Linux / Windows-WSL.
- ULID uniqueness under adversarial clock manipulation — trust the library.
- Fuzzed resolver inputs — allowlist discipline per NFR-19 makes this low-value.

## 4. Coverage Targets

| Layer | Target | Minimum |
|-------|--------|---------|
| Tier 1 — Static (ACs referencing literal strings, sections, anchors) | 100% | 100% |
| Tier 2 — Behavioral (FRs with observable behavior change) | 100% of active FRs | All critical-path FRs |
| Tier 3 — Regression (core workflow on golden fixtures) | 100% — any diff is stop-ship | Same |
| Tier 4 — Unit (all `adapters/**/src/*.ts` modules + `plugins/**/tests/*.test.ts`) | 100% of branches + mutation probes per NFR-21 | 100% branches |
| Tier 5 — Manual adapter conformance | Documented pass per shipped adapter before release | Same |

## 5. Test Data

**Reference stack:** `plugins/dev-process-toolkit/examples/typescript-node/` (primary). `flutter-dart/` and `python/` used for stack-specific CI config regressions.

**Project fixtures** under `plugins/dev-process-toolkit/tests/fixtures/projects/`:

- `fresh-ts/` — empty TypeScript project for `/setup`, `/spec-write` scenarios.
- `simple-milestone/` — specs/ with one milestone fully spec'd, ready for `/implement`.
- `archivable/` — one milestone complete with matrix populated plus one in-flight milestone (used for archival-path tests).
- `anchor-less/` — specs/ with no `{#...}` anchors (doctor validation).
- `mode-none-regression/` — no `## Task Tracking` section; exercises all skills for byte-comparison baseline.
- `clean-sync/`, `tracker-only-ac/`, `edited-both/`, `branch-regex-mismatch/` — FR-39 sync-loop scenarios.
- `capability-degradation/` — adapter missing `push_ac`; assert NFR-10 warning.
- `docs-user-facing/` — `CLAUDE.md` with `user_facing_mode: true`, seeded canonical tree, pending fragment to exercise `/docs --commit`.
- `docs-packages/` — same but `packages_mode: true`; includes TypeScript module exports for signature extraction.
- `docs-mixed/` — both modes true; exercises shared `tutorials/` / `explanation/` + split `reference/`.
- `docs-disabled/` — no `## Docs` section; asserts `/docs` refuses with NFR-10 and `/implement` Phase 4b is a silent no-op when docs disabled.
- `implement-with-docs-hook/` — enabled docs config + known FR + staged diff; `/implement` run must produce `docs/.pending/<fr-id>.md` and the Deviation Report row; companion `-disabled` variant asserts byte-identical pre-docs-hook behavior.
- `ship-milestone-happy/` — milestone with all FRs archived, seeded `.pending/` fragments, version files; `/ship-milestone` produces expected 4-file bump + CHANGELOG entry + README update + merged docs; approval-refusal path asserts zero writes.
- `ship-milestone-unshipped-fr/` — milestone with one `status: active` FR; asserts unshipped-FR refusal.

**v2-minimal fixture** at `tests/fixtures/v2-minimal/`: one active tracker-less FR + one active tracker-configured FR + one in-progress FR + one archived FR + two plan files + slimmed cross-cutting specs + per-skill captured snapshots.

**Lock-scenario fixtures** at `tests/fixtures/lock-scenarios/`: fresh-repo, local-lock-held, remote-lock-held, stale-lock-merged.

**Resolver fixtures** at `tests/fixtures/resolver/`: `linear-only/`, `linear-and-jira-distinct-prefixes/`, `linear-and-jira-overlapping-prefixes/`, `no-trackers/` — each is a CLAUDE.md + synthetic `specs/frs/` tree covering one resolver configuration.

**MCP response fixtures** at `tests/fixtures/mcp/<tracker>/`: hand-crafted JSON for `get_issue`, `update_issue`, empty-AC, all-checked; Jira `rest_api_3_field.json` + field-absent variant.

**Diff fixtures** at `tests/fixtures/diffs/`: `added_public_fn.patch`, `modified_signature.patch`, `internal_helper.patch`, `cli_command.patch`, `package_json_script.patch`, `enum_value.patch`, `empty.patch` — one per `ImpactSet` extraction category + the empty-set boundary.

**Signature-extraction fixtures** at `tests/fixtures/signature_extraction/`: self-contained TypeScript project (`tsconfig.json` + `src/simple_function.ts`, `src/generic_class.ts`, `src/type_alias.ts`, `src/overloads.ts`, `src/internal_helper.ts`). Exercises ts-morph AST extraction against known exports. Per-strategy tests mock out typedoc or force regex fallback.

**Baselines** at `tests/fixtures/baselines/`: snapshot output of every skill in `mode: none` for byte-comparison regression (Pattern 9 backward-compatibility invariant).

**Fixtures we do NOT create:**

- Live tracker OAuth tokens in any form (NFR-9).
- Machine-recorded MCP responses (hand-crafted for reviewability + PII).
- Cross-adapter interop fixtures (each adapter tested in isolation).
- Fuzzed inputs (deterministic fixtures suffice for v1).
- Large-scale migration fixtures (>100 FRs) — NFR-11 is advisory; bench tooling runs locally.

---
