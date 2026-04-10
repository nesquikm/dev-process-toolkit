# Changelog

All notable changes to the Dev Process Toolkit plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Update discipline:** this file must be updated on every version bump. See the Release Checklist in `CLAUDE.md` for the required steps.

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
