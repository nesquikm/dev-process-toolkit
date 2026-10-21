# Changelog

All notable changes to the Dev Process Toolkit plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Update discipline:** this file must be updated on every version bump. See the Release Checklist in `CLAUDE.md` for the required steps.

## [2.99.2] — 2026-10-21 — "Short Fuse"

### Fixed

- Nested test runs and the gate carry hard time limits (STE-685). Every test that starts a nested `bun test` now goes through one shared runner with a 300 s timeout, SIGKILL, the parent's own bun, and a depth guard that refuses at 3. A sweep test keeps direct spawns from coming back. The gate root's `bunfig.toml` sets a 30 s per-test budget, enforced by a `setDefaultTimeout` preload because bun 1.3.14 parses `[test] timeout` but does not apply it.
- Test waits and product child processes are bounded (STE-686). The STE-594/595 harness waits are async and their `ps` calls time out, so bun can stop a test that overruns. typedoc, the falsifiability assertion and the spawn receipt's ownership check stop at their bounds with SIGKILL. The gate run is bounded at 40 minutes and escalates SIGTERM to SIGKILL on its whole process group, so a runner that ignores SIGTERM still ends. `gate_capture.ts` names every failing test from the run's own report, says so when the report cannot be read, and reports a run killed on its bound. `docs/implement-reference.md` carries the capture recipe for a stalled gate.
- The supervisor mints the spawn receipt a worker cannot (STE-687). With no fifth argument, the receipt printer finds agent-toolkit's `owned.py` through the plugin registry, directory source first, and refuses by name when none resolves. `/deliver` has the supervisor run it and hand the line to the worker, which pastes it verbatim.
- The bug FR guide says a TODO regression fails probe #88 (STE-688). `docs/resolver-entry.md` § Bug FR body now states that a `Regression:` criterion with no body, or only a TODO marker, fails the gate until a test is named.

Total test count at release: 19260 tests, 0 failures, 0 errors.

## [2.99.1] — 2026-10-21 — "Fine Print"

### Fixed

- Gate-check probe #88 now grades each bug section where it belongs (STE-681). Steps to reproduce, Expected and Actual must sit under `## Requirement` and Root cause under `## Technical Design`; a section found anywhere else is reported as misplaced, naming where it was found. A `Regression:` criterion with no body or only a TODO marker no longer counts, so a freshly imported bug stays red until someone names the test. Fenced code is never read as a heading or a criterion. Import moves a Root cause the ticket supplies under `## Technical Design`, and Schema Q lists the `kind` key.
- Import refuses a ticket it cannot read for bug detection (STE-682). When no readable answer holds the ticket, or the answer lacks the Linear `labels` list or the Jira issue type name, the import stops in the NFR-10 shape before any file or tracker write, instead of filing a possible bug as a plain FR.
- The bun test-count fallback stops subtracting skips twice (STE-683). Output with no `Ran N tests` line now totals pass, fail and skip, so stage evidence reports the real pass count.
- The `--bug` issue-type check runs before a new milestone Epic exists (STE-684). The Jira Epic key is optional; without it the check still grades the type and names "the new milestone Epic". `/spec-write` orders the check before the Epic is created.

Total test count at release: 19157 tests, 0 failures, 0 errors.

## [2.99.0] — 2026-10-21 — "Field Report"

### Added

- `/spec-write --bug` files a bug as a bug (STE-679). The flag writes `kind: bug` into the FR frontmatter and defaults `changelog_category` to `Fixed`; `Security` is the only other category it accepts. The body asks for steps to reproduce, expected and actual results, the root cause and a `Regression:` acceptance criterion, and `--bug --no-tech` asks only the observable questions. In tracker mode the run first proves the bug type exists, by exact name: a Jira issue type that can sit under the milestone Epic (`jira_bug_issue_type`, default `Bug`), or a live Linear label (`linear_bug_label`, default `Bug`). A missing type refuses before any tracker write or file. `decide --bug` then carries the type in the create payload, and the Jira create step files it as that issue type.
- Bugs imported from the tracker stay bugs, and the gate grades them (STE-680). A Jira ticket whose issue type is the bug type, or a Linear issue carrying the bug label, imports as `kind: bug` with `changelog_category: Fixed`, from a fetched ticket or a listing page alike. Its body gets TODO bug sections and a TODO `Regression:` criterion unless the ticket already supplies them. New gate-check probe #88 `bug_fr_shape` fails an active bug FR that lacks any of those pieces, a bug whose category is not `Fixed` or `Security`, and any `kind:` value other than `bug`.

### Known defects

- An imported TODO `Regression:` criterion satisfies probe #88's regression check, because the probe checks only that an AC begins `Regression:`. The TODO bug sections still keep the imported FR red.
