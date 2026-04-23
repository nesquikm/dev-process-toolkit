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

Full sub-step ordering for the Phase 4 Milestone Archival block (STE-22). The skill itself carries a condensed summary; consult this section when executing the archival or debugging an interrupted run. Sub-steps are lettered to avoid clashing with the Phase 4 flow numbering (steps 13–15 in the skill).

a. Scan `specs/frs/*.md` for every FR with frontmatter `milestone == <current>`. Build the FR batch.
b. For each batched FR: plan one `git mv specs/frs/<ulid>.md specs/frs/archive/<ulid>.md` + frontmatter flip (`status: active → archived`; set `archived_at: <ISO now>`) + one `Provider.releaseLock(<ulid>)` call.
c. If `specs/plan/<M#>.md` exists, plan one `git mv specs/plan/<M#>.md specs/plan/archive/<M#>.md` (AC-STE-21.5) to batch alongside the FR moves.
d. Present the full batch as a diff preview — list every `git mv`, every frontmatter flip, every `releaseLock`. Do not summarize.
e. On explicit human approval (Phase 4 step 15): execute all moves + flips + `releaseLock` calls and commit atomically in a single commit (AC-STE-22.2, AC-STE-22.6). Any error aborts the entire batch — no partial archival.
f. Run the Post-Archive Drift Check from `skills/spec-archive/SKILL.md` § Post-Archive Drift Check. Render the unified Schema I table; offer the 3-choice UX (address inline / save to `specs/drift-<date>.md` / acknowledge). The drift check never blocks the already-committed archival.
g. `specs/technical-spec.md` is **never** archived — ADRs use `Superseded-by:` in place (ADR convention).

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
