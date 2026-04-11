# `/implement` Reference

Extended reference material for `/dev-process-toolkit:implement` that was extracted from `skills/implement/SKILL.md` to keep the skill file under the NFR-1 300-line cap. The skill file contains a one-line pointer to this file at the Stage C section.

This reference is **not required reading** on every run — the skill itself has enough guidance to operate. Consult this file when Stage C (Hardening) is run on round 1 of the self-review loop, or when a hardening pass needs concrete examples.

## Phase 3 Stage C — Hardening Pass (first round only)

After Stage B passes on round 1, run a hardening pass before declaring victory. Skip this on round 2 (diminishing returns).

### f. Negative & edge-case tests

For each module created or modified, ask:

- What happens with empty / null / missing input?
- What happens at boundary values (`0`, `-1`, `MAX_INT`, empty string, empty array, single-element array)?
- What happens when an external dependency fails (network error, timeout, malformed response, unexpected status code)?
- Are there race conditions or ordering assumptions? Can two writers clobber each other? Can a reader observe a partial write?
- What happens under concurrent load (if the module is called from multiple callers)?

You don't need to test every combination — focus on the cases most likely to cause real bugs. Add tests for any gaps found. If the module is a pure function with a small input space, consider property-based testing; if it's a state machine, test every transition at least once.

### g. Error path audit

Verify that error handling:

- **Doesn't swallow errors silently** — caught exceptions must either be rethrown, logged with context, or explicitly ignored with a comment explaining why.
- **Doesn't leak sensitive information in error messages** — no raw database errors to the client, no stack traces in production responses, no credentials or PII in logs.
- **Returns appropriate error types/codes at system boundaries** — HTTP 4xx for client errors, 5xx for server errors; typed error unions for internal APIs; specific exception classes, not bare `Exception` catches.
- **Has a retry or fallback strategy where appropriate** — transient failures on external deps usually warrant bounded retry; permanent failures should fail fast.
- **Logs enough context to diagnose** — include the operation name, inputs (redacted), and the downstream error.

### Stack-specific hardening examples

These are illustrative — use the patterns in your project's CLAUDE.md as the authoritative list.

- **TypeScript / Node:** verify `async/await` error propagation (no unhandled rejections); check that `Promise.all` isn't hiding partial failures; confirm `JSON.parse` is wrapped in try/catch at system boundaries.
- **Python:** verify `with` statements close resources on exception; check that `except Exception:` is specific or commented; confirm `asyncio.gather` uses `return_exceptions=True` when partial failure is acceptable.
- **Flutter / Dart:** verify `async` functions return `Future` and are `await`ed; check that `Stream` subscriptions are cancelled in `dispose()`; confirm `tryEmit()` is used on closed BLoCs.
- **Go:** verify every returned `error` is checked; check that deferred `Close()` calls are paired with error handling; confirm context cancellation propagates through goroutines.
- **Rust:** verify `Result` is not discarded with `let _ = ...`; check that `?` propagates errors to the right boundary; confirm `panic!` is only used for truly unreachable states.

## Milestone Archival Procedure

Full sub-step ordering for the Phase 4 Milestone Archival block. The skill itself carries a condensed summary; consult this section when executing the archival or debugging an interrupted run. Sub-steps are lettered to avoid clashing with the Phase 4 flow numbering (steps 13–15 in the skill).

a. Resolve the archive target: `specs/archive/M{N}-{slug}.md`, where `{slug}` is the lowercased hyphen-separated milestone title.
b. Consult the `specs/requirements.md` traceability matrix: find every AC whose row was populated (Implementation and Tests columns) during this milestone.
c. **Collapse rule:** for any FR whose ACs are *all* archived by this operation, the live `requirements.md` keeps only a Schema H pointer line in place of the FR block. FRs with mixed status keep their FR header and any non-archived ACs; only the archived ACs move.
d. Build the archive file body following Schema G (see `specs/technical-spec.md` §4): YAML frontmatter (`milestone`, `title`, `archived`, `revision: 1`, `source_files`), then three sections in order — `## Plan block (from plan.md)` with the verbatim milestone block, `## Requirements block (from requirements.md)` with the verbatim archived FR/AC content, `## Traceability (from requirements.md matrix)` with the matched matrix rows.
e. **Write the archive file first**, before excising anything from the live specs. If the subsequent live-file edit fails, the user still has both the archive and the untouched original.
f. **Move (do not copy)** the `## M{N}: {title} {#M{N}}` block out of `plan.md`, leaving in its place exactly one Schema H blockquote pointer line at the original location: `> archived: M{N} — {title} → specs/archive/M{N}-{slug}.md ({YYYY-MM-DD})`. The em-dash and right-arrow are literal.
g. For every wholly-archived FR in `requirements.md`, collapse the block to the same Schema H pointer line. For FRs with mixed status, remove only the archived ACs.
h. Append one new row to `specs/archive/index.md` per archival: `| M{N} | {title} | {YYYY-MM-DD} | [M{N}-{slug}.md](M{N}-{slug}.md) |`. Never rewrite existing rows.
i. If the traceability matrix is incomplete (some AC rows for this milestone have no Implementation/Tests entries), **move only the plan block** and emit a warning asking the user to archive the orphaned ACs manually via `/dev-process-toolkit:spec-archive`.

## Decision matrix (round resolution)

The self-review loop has hard exit conditions that Stage C feeds into. For reference:

| Outcome | Action |
|---------|--------|
| All stages pass + gate confirms clean (`GATE PASSED`) | Exit loop, proceed to Phase 4 |
| Gate returns `GATE PASSED WITH NOTES` | Treat non-critical notes as informational, include in Phase 4 report, exit loop |
| Issues found on round 1 | Fix, re-run gate check, go to round 2 |
| Issues found on round 2, same issue types as round 1 | **STOP and escalate** — going in circles |
| Issues found on round 2, different issue types | Fix, re-run gate check, escalate to user (diminishing returns) |

After any fix, always re-run the full gate check before continuing. Read the actual output and report the numbers (e.g., `47 tests, 0 failures, 0 errors`). Never claim clean from memory of a previous run.
