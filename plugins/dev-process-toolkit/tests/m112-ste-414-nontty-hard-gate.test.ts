import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// M112 "non-tty hard gate" — prose-conformance meta-tests for the two
// project-local driver SKILL.mds. STE-414 closes the two escape hatches the
// 2026-07-24 /conformance-loop run drove straight through: BOTH legs exited
// rc=0 in ~8 min without running the canonical chain and left orphaned
// tracker data behind.
//
//   * Jira leg — F3 fire-and-exit RECURRENCE. The driver spawned /setup as a
//     background task and ended its turn narrating itself as "an interactive
//     parent" while it was in fact a nested `claude -p` session. STE-365's
//     SMOKE-CTX probe was already there; it was ADVISORY, so it got narrated
//     past.
//   * Linear leg — discretionary prose-pause. The driver asked the operator a
//     3-option rate-limit question mid-run and ended its turn. Under non-tty a
//     prose-ask-then-end-turn is a silent no-op: leg exits rc=0, chain never
//     runs, Linear project orphaned. No prior guardrail covered this path at
//     all.
//
// The through-line STE-355 → STE-357 → STE-365 → STE-414: every prior FR
// added a prose guardrail and every one was rationalized around at runtime.
// So THIS FILE is the enforcement mechanism — a whole-file grep that any
// nearby unrelated sentence can satisfy would repeat the exact mistake the FR
// fixes. Every predicate below is SECTION-SCOPED and paragraph-proximate.
//
// AC-STE-414.1 — the SMOKE-CTX probe is restated as a HARD GATE: the
//   `[ -t 0 ]` result is the SOLE determinant, a headless classification is
//   BINDING, and the "interactive parent" self-narration is byte-pinned as the
//   forbidden rationalization.
// AC-STE-414.2 — the child-spawn-discipline FORBIDDEN callout names all four
//   grandchild-wait escape paths in ONE paragraph (run_in_background /
//   Monitor / background-completion wait / turn-yield) plus the "interactive
//   parent" rationalization plus the only-sanctioned-wait rule. Includes the
//   STE-365.3 drift guard: the fix cannot delete the detached-spawn + pidfile
//   + bounded-poll snippet it protects. (Drift-guard assertions are GREEN
//   before implementation BY DESIGN — same posture as m98's AC-STE-365.3; the
//   RED signal for this AC lives in the one-paragraph predicate.)
// AC-STE-414.3 — a new discretionary-halt guard resolves every mid-run
//   judgment call deterministically off the auto-approve marker: present ⇒
//   proceed, absent ⇒ abort-with-full-teardown, and NO prose-ask-then-end-turn
//   path exists under non-tty.
// AC-STE-414.4 — the final-message self-check is strengthened from "resume the
//   poll" into a hard abort-with-teardown, for an incomplete chain OR a live
//   pidfile, never exiting rc=0 silently. The `[~]` runtime-deferred posture
//   is retired out of that clause. A spec-review audit graded the first pass
//   *Partial* and this file closes the gap it named — two escapes survived a
//   "loud abort + teardown" that satisfies every literal instruction:
//     (a) the rc=0 loophole. The clause never names an exit code, and the
//         prohibition is qualified ("never exit rc=0 SILENTLY", "a SILENT
//         success exit is legal only when…"). "I emitted SMOKE-ABORT and ran
//         teardown, so this was not a *silent* rc=0 exit" is a reading the
//         text licenses — the turn ends, `claude -p` returns 0, the parent
//         reads a clean run. The discretionary-halt guard's Branch 2 already
//         says "then exit non-zero", so the omission reads as deliberate.
//         ⇒ contracts 4a (mandate non-zero) + 4b (state it unqualified).
//     (b) the unachievable invariant. Both drivers assert "There is no third
//         branch in which the turn ends while a pidfile still answers
//         `kill -0`" — but the abort branch the same paragraph sanctions
//         routes to `### Phase 5 — Teardown`, which has ZERO pid handling.
//         Aborting archives the tracker project and `rm -rf`s the test dir and
//         leaves the grandchild live, so the turn ends with a pidfile that
//         still answers. A rule its own sanctioned branch violates is exactly
//         the prose an LLM resolves in its own favour.
//         ⇒ contract 5 (the abort branch reaps before ending).
//     (c) the reap's own TOCTOU. Contract 5 turned the abort branch into a
//         REAL `kill` against a PID proven live by a `kill -0` probe moments
//         earlier — liveness, never identity. A PID recycled in that gap takes
//         a signal meant for the grandchild, on the operator's machine. The
//         `Residual risk — PID reuse` paragraph sitting a few lines above
//         reasons about the POLL only (where reuse is genuinely benign) and so
//         now reads as blanket absolution for an instruction it does not cover.
//         ⇒ contract 5c (identity-check the PID before signalling it, and
//         extend the residual-risk framing to the destructive case).
// AC-STE-414.5 — each of the THREE abort clauses routes through Phase 5
//   teardown, asserted SEPARATELY per clause: a single global "teardown"
//   mention must not be able to satisfy all three.
// AC-STE-414.6 — parity: the hard-gate + discretionary-halt + end-of-turn
//   abort-with-teardown clauses are mirrored into /conformance-loop's Phase A
//   driver surface (extending STE-365.4).

const repoRoot = join(import.meta.dir, "..", "..", "..");
const skillPath = join(repoRoot, ".claude", "skills", "smoke-test", "SKILL.md");
const conformanceLoopPath = join(
  repoRoot,
  ".claude",
  "skills",
  "conformance-loop",
  "SKILL.md",
);

function readIfPresent(path: string): string | null {
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
}

// Dogfood-only surface: a plugin-only checkout has neither harness SKILL, so
// the suite skips cleanly instead of failing.
const skill = readIfPresent(skillPath);
const describeIfPresent = skill === null ? describe.skip : describe;

const conformanceLoop = readIfPresent(conformanceLoopPath);
const describeIfConformanceLoopPresent =
  conformanceLoop === null ? describe.skip : describe;

// ---------------------------------------------------------------------------
// Slicing helpers — section scoping is the whole point of this file
// ---------------------------------------------------------------------------

function sectionSlice(
  body: string,
  startMarker: string,
  endMarker: string,
): string {
  const start = body.indexOf(startMarker);
  if (start === -1) return "";
  const end = body.indexOf(endMarker, start + startMarker.length);
  return end === -1 ? body.slice(start) : body.slice(start, end);
}

// A markdown subsection: from the first line starting with `startsWith` to the
// next heading of any level, fence-aware (a `## ` inside a ```bash fence is
// not a heading). Keeps each AC's assertions inside its own subsection so a
// neighbouring clause can never satisfy them.
function subsection(body: string, startsWith: string): string {
  const lines = body.split("\n");
  const start = lines.findIndex((line) => line.startsWith(startsWith));
  if (start === -1) return "";
  let inFence = false;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^#{2,6} /.test(lines[i])) return lines.slice(start, i).join("\n");
  }
  return lines.slice(start).join("\n");
}

// A bold-lead clause (`**Final-message self-check …**`) and everything under
// it up to the NEXT bold-lead clause or heading. Bounded like a subsection, so
// a multi-paragraph strengthening still reads as one clause while the
// neighbouring `**Red flag …**` / `**Fail-fast …**` clauses cannot leak in.
function boldClause(body: string, leadIn: string): string {
  const lines = body.split("\n");
  const start = lines.findIndex((line) => line.startsWith(leadIn));
  if (start === -1) return "";
  let inFence = false;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^#{2,6} /.test(lines[i])) return lines.slice(start, i).join("\n");
    if (/^\*\*[^*\n]+\*\*/.test(lines[i]) && !lines[i].startsWith(leadIn)) {
      return lines.slice(start, i).join("\n");
    }
  }
  return lines.slice(start).join("\n");
}

// Every ```bash fence body inside a section.
function bashFences(section: string): string[] {
  const fences: string[] = [];
  const re = /```bash\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(section)) !== null) fences.push(match[1]);
  return fences;
}

// Drop fenced blocks (keeping paragraph boundaries) so a clause the AC says
// must live in SKILL *prose* cannot be satisfied by editing an echo string
// inside the probe's bash fence.
function proseOnly(section: string): string {
  return section.replace(/```[a-z]*\n[\s\S]*?```/g, "\n\n");
}

// Paragraph-proximity: some blank-line-delimited paragraph satisfies ALL the
// given patterns (avoids trivially matching two unrelated sentences).
function someParagraphMatches(body: string, patterns: RegExp[]): boolean {
  return body
    .split(/\n\n+/)
    .some((paragraph) => patterns.every((re) => re.test(paragraph)));
}

// --- region accessors -------------------------------------------------------

// § Phase-2-entry context probe — the SMOKE-CTX hard gate's home.
function smokeCtxSection(body: string): string {
  return subsection(body, "#### Phase-2-entry context probe");
}

// § Discretionary-halt guard — new subsection (STE-414), co-located after the
// SMOKE-CTX probe per the FR's Technical Design.
function discretionaryHaltSection(body: string): string {
  return subsection(body, "#### Discretionary-halt guard");
}

// § Phase 2 child-spawn discipline — the actual spawn site, sliced to the next
// subsection so the FORBIDDEN callout stays co-located with the spawn snippets.
function childSpawnDisciplineSection(body: string): string {
  return subsection(body, "#### Phase 2 child-spawn discipline");
}

// § Grandchild spawn lifecycle — home of the detached-spawn + pidfile +
// bounded-poll snippet (drift guard) and the final-message self-check clause.
function grandchildMachinery(body: string): string {
  return subsection(body, "#### Grandchild spawn lifecycle");
}

// The final-message self-check clause, in either driver.
function finalMessageSelfCheckClause(body: string): string {
  return boldClause(body, "**Final-message self-check");
}

// § Phase 5 — Teardown (smoke-test only; the single abort target).
//
// LINE-START ANCHORED on purpose. This milestone added BACKTICKED
// `### Phase 5 — Teardown` cross-references inside the AC.1/AC.3/AC.4 abort
// clauses, and those refs sit ~750 lines ABOVE the real heading. A bare
// `indexOf("### Phase 5 — Teardown")` therefore locks onto the first
// backticked ref and returns a 16x-over-wide slice (measured: 81998 chars
// spanning the whole mid-file body instead of the real 5025-char Phase 5
// section), which destroys the drift guard two ways: deleting the real HEADING
// no longer trips the `length > 0` guard, and any drift token that merely
// migrates into the over-wide span keeps the guard green while Phase 5 itself
// has lost it. Backticked refs are always mid-paragraph, never at line start,
// so the `\n`-anchored markers are unambiguous.
//
// Do NOT swap this for `subsection()`: Phase 5 contains `#### Linear path` and
// `#### Jira path`, so a subsection slice truncates at the first of them and
// loses all four drift tokens (measured: 1084 chars, zero tokens present).
function phase5Section(body: string): string {
  return sectionSlice(body, "\n### Phase 5 — Teardown\n", "\n### Phase 8");
}

// § Phase A of /conformance-loop — leg spawn + poll + RC collection.
function phaseASlice(body: string): string {
  return sectionSlice(
    body,
    "### Phase A — Parallel /smoke-test fan-out + aggregation",
    "## Findings",
  );
}

// ---------------------------------------------------------------------------
// Shared contract predicates — applied to BOTH driver SKILLs so AC-STE-414.6's
// parity is byte-pinned by the same code, not by a re-typed near-copy.
// ---------------------------------------------------------------------------

// Contract 1a — the `[ -t 0 ]` result is the SOLE determinant and a headless
// classification is BINDING for the rest of the run.
function statesBindingHeadlessClassification(prose: string): boolean {
  return someParagraphMatches(prose, [
    /\[ -t 0 \]/,
    /binding/i,
    /sole determinant/i,
  ]);
}

// Contract 1b — no self-narration re-opens the gate; the "interactive parent"
// rationalization is named as forbidden (byte-pinned: it is the literal
// 2026-07-24 Jira-leg wording).
function forbidsInteractiveParentSelfNarration(prose: string): boolean {
  return someParagraphMatches(prose, [
    /interactive parent/i,
    /self-narrat/i,
    /overrid|forbidden|MUST NOT|may not/i,
  ]);
}

// Contract 2a — marker present ⇒ proceed with the full run.
function statesMarkerPresentProceeds(prose: string): boolean {
  return someParagraphMatches(prose, [
    /marker/i,
    /present/i,
    /proceed/i,
  ]);
}

// Contract 2b — marker absent ⇒ abort with full teardown.
function statesMarkerAbsentAbortsWithTeardown(prose: string): boolean {
  return someParagraphMatches(prose, [
    /marker/i,
    /absent|without the marker/i,
    /abort/i,
    /teardown/i,
  ]);
}

// Contract 2c — there is NO prose-ask-then-end-turn path under non-tty.
function forbidsProseAskThenEndTurn(prose: string): boolean {
  return someParagraphMatches(prose, [
    /prose-ask/i,
    /end.the.turn|end-turn/i,
    /non-tty|headless/i,
  ]);
}

// Contract 3 — the end-of-turn self-check is a hard abort-with-teardown, for
// an incomplete chain OR a live pidfile, never a silent rc=0 exit.
function isHardAbortWithTeardown(clause: string): boolean {
  return (
    /\babort/i.test(clause) &&
    /teardown/i.test(clause) &&
    /never|NEVER/.test(clause) &&
    /\brc\s*=?\s*0\b/i.test(clause) &&
    /silent/i.test(clause)
  );
}

// Contract 3 triggers — BOTH must be named.
function namesBothEndOfTurnTriggers(clause: string): boolean {
  return (
    someParagraphMatches(clause, [/incomplete|unfinished/i, /chain/i]) &&
    /live pidfile/i.test(clause)
  );
}

// Prose sentences of a clause (fences dropped, line-wrapping normalized), so a
// predicate can require ONE sentence to carry a whole rule rather than letting
// two unrelated sentences co-satisfy it.
// A clause's prose with fences dropped and line wrapping flattened. The
// sequencing predicates below take CHARACTER OFFSETS against this string, so
// `proseSentences` derives from it too — otherwise the two would disagree about
// where a sentence begins.
function flatProse(clause: string): string {
  return proseOnly(clause).replace(/\n+/g, " ");
}

function proseSentences(clause: string): string[] {
  return flatProse(clause).split(/(?<=[.!?])\s+/);
}

// Contract 4a — the abort branch mandates a NON-ZERO exit.
//
// The rc=0 loophole this closes: the hardened clause tells the driver to abort
// LOUDLY (`SMOKE-ABORT:` / `LOOP-ABORT:`) and run teardown, but never names an
// exit code. An adversarial driver satisfies every literal instruction, ends
// the turn, and `claude -p` hands the PARENT rc=0 — the exact signal the clause
// exists to suppress. The discretionary-halt guard's Branch 2 already says
// "then exit non-zero", so the omission here reads as deliberate by contrast.
// Paragraph-scoped and satisfiable by one in-clause sentence.
function mandatesNonZeroExitOnAbort(clause: string): boolean {
  return someParagraphMatches(proseOnly(clause), [
    /\babort/i,
    /\bMUST\b/,
    /\bexits?\b[^.\n]{0,60}\bnon-?zero\b|\bnon-?zero\b[^.\n]{0,60}\bexit/i,
  ]);
}

// Vocabulary that makes a prohibition unconditional rather than qualified.
const UNCONDITIONAL_SCOPE_RE =
  /loud(?:ly)? or not|regardless of|whether or not|under either trigger|no matter|in either case|unqualified/i;

// Contract 4b — the never-rc=0 rule is stated UNQUALIFIED.
//
// Today the prohibition hinges on one adverb: "must NEVER exit rc=0 SILENTLY",
// "A SILENT success exit is legal only when…". That qualifier is the whole
// loophole — "I emitted SMOKE-ABORT and ran teardown, so my rc=0 exit was not
// *silent*" is a reading the text licenses. So: SOME single sentence must state
// the prohibition with no silent/quiet qualifier in it AND with an explicitly
// unconditional scope. The existing qualified sentences may stay (contract 3
// above still keys off "silent") — this predicate demands an additional
// stand-alone unconditional formulation, not a rewrite of the surrounding
// paragraph.
function statesUnqualifiedNeverRcZero(clause: string): boolean {
  return proseSentences(clause).some(
    (sentence) =>
      /\bnever\b/i.test(sentence) &&
      /\brc\s*=?\s*0\b/i.test(sentence) &&
      /\bexit/i.test(sentence) &&
      !/\b(silent|silently|quiet|quietly)\b/i.test(sentence) &&
      UNCONDITIONAL_SCOPE_RE.test(sentence)
  );
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Contract 5 — the abort branch REAPS before the turn ends.
//
// Both drivers assert an invariant their own sanctioned abort branch cannot
// satisfy: "There is no third branch in which the turn ends while a pidfile
// still answers `kill -0`". But the abort branch routes to `### Phase 5 —
// Teardown`, which carries ZERO pid/kill handling — it archives the tracker
// project and `rm -rf`s the test directory, and the grandchild keeps running.
// So aborting ends the turn with a live pidfile, and the invariant is prose an
// LLM will resolve in its own favour. Make it true: the abort clause must
// instruct killing the live pidfile PIDs and removing the pidfiles.
//
// `kill -0` is excluded from the kill pattern deliberately — the clause already
// says a pidfile "still answers `kill -0`", and a liveness probe is not a reap.
function reapsLivePidfilesOnAbort(clause: string, pidGlob: string): boolean {
  return someParagraphMatches(proseOnly(clause), [
    /\babort/i,
    /\bkill\b(?!\s*-\s*0\b)/i,
    /\brm -f\b/,
    new RegExp(escapeRegExp(pidGlob)),
  ]);
}

// Drift guard for contract 5: the invariant must be made TRUE, not deleted.
function keepsNoThirdBranchInvariant(clause: string): boolean {
  return /no third branch/i.test(clause) && /kill -0/.test(clause);
}

// --- Contract 5b — the reap must be SEQUENCED BEFORE the destructive teardown
//
// Contract 5 above pins CO-OCCURRENCE only: `abort` + a non-`kill -0` `kill` +
// `rm -f` + the pidfile glob somewhere in the same paragraph. Order was never
// constrained, and the first pass satisfied the predicate with prose that reaps
// in exactly the wrong order — "The abort MUST also reap before the turn ends:
// AFTER the Phase 5 teardown actions, `kill` every PID recorded in a
// still-answering pidfile, then `rm -f /tmp/dpt-smoke-*.pid`" (and the per-leg
// twin in /conformance-loop).
//
// That is a race, not a wording nit. The sanctioned abort branch archives/closes
// the tracker project and `rm -rf`s the test directory while the grandchild /
// leg is STILL LIVE: it can be mid-write into the directory being removed and
// still posting to the project being archived, and `### Phase 5 — Teardown`
// itself carries ZERO pid/kill handling (so nothing downstream re-orders it).
// The reap has to happen FIRST — quiesce the process, then destroy its state.
//
// Both instructions are anchored on their OWN specific sentence so an unrelated
// earlier token mention cannot stand in for either: the reap on a non-`kill -0`
// `kill` together with `rm -f <pidfile glob>`; the teardown on the pair of
// actions that make it destructive (`rm -rf` AND archive/close), which a bare
// cross-reference to "teardown" or a `rm -rf` cited as rationale cannot fake.
//
// Satisfiable by an IN-CLAUSE sentence reorder — no section or paragraph
// boundary needs to move.

/** The reap: kill the recorded PIDs (not the `kill -0` probe) + drop the pidfiles. */
function carriesReapInstruction(sentence: string, pidGlob: string): boolean {
  return (
    /\bkill\b(?!\s*-\s*0\b)/i.test(sentence) &&
    new RegExp("\\brm -f " + escapeRegExp(pidGlob)).test(sentence)
  );
}

/** The destructive teardown: remove the test dir AND archive/close the project. */
function carriesDestructiveTeardownInstruction(sentence: string): boolean {
  return /\brm -rf\b/.test(sentence) && /archive\/close/i.test(sentence);
}

/**
 * Character offset, inside the clause's flattened prose, of the ONE sentence
 * carrying an instruction. Returns -1 when no sentence carries it *or* when
 * several do — an ambiguous clause fails rather than letting the predicate pick
 * a convenient occurrence.
 */
function instructionOffset(
  clause: string,
  carries: (sentence: string) => boolean,
): number {
  const hits = proseSentences(clause).filter(carries);
  if (hits.length !== 1) return -1;
  return flatProse(clause).indexOf(hits[0]!);
}

/** Reap instruction positioned ahead of the destructive teardown instruction. */
function reapPrecedesDestructiveTeardown(
  clause: string,
  pidGlob: string,
): boolean {
  const reapAt = instructionOffset(clause, (sentence) =>
    carriesReapInstruction(sentence, pidGlob),
  );
  const teardownAt = instructionOffset(
    clause,
    carriesDestructiveTeardownInstruction,
  );
  if (reapAt < 0 || teardownAt < 0) return false;
  if (reapAt !== teardownAt) return reapAt < teardownAt;
  // Both instructions merged into ONE sentence ("…reap…, and only then run
  // `### Phase 5 — Teardown` in full…") is a legal fix, so compare token
  // offsets inside that sentence rather than declaring a tie a failure.
  const sentence = flatProse(clause).slice(reapAt);
  const reapToken = sentence.search(
    new RegExp("\\brm -f " + escapeRegExp(pidGlob)),
  );
  const teardownToken = sentence.search(/\brm -rf\b/);
  return reapToken >= 0 && teardownToken >= 0 && reapToken < teardownToken;
}

// The literal defect phrasing — the reap sentence sequencing ITSELF after the
// teardown ("after the Phase 5 teardown actions" / "after the per-leg teardown
// actions"). Deliberately window-limited to `after` + ≤3 plain words +
// `teardown`, so a correct fix reading "only after that reap may the driver run
// `### Phase 5 — Teardown` in full" is NOT caught (the em dash and backticked
// heading break the word run). State the ordering positively: reap first, then
// tear down.
const REAP_SEQUENCED_AFTER_TEARDOWN_RE = /\bafter\s+(?:[\w-]+\s+){0,3}teardown\b/i;

function reapNotSequencedAfterTeardown(
  clause: string,
  pidGlob: string,
): boolean {
  const reap = proseSentences(clause).find((sentence) =>
    carriesReapInstruction(sentence, pidGlob),
  );
  if (reap === undefined) return false;
  return !REAP_SEQUENCED_AFTER_TEARDOWN_RE.test(reap);
}

// --- Contract 5c — the reap must check PROCESS IDENTITY before it signals ---
//
// Contract 5 made the abort branch reap and contract 5b made it reap FIRST. But
// the reap is a REAL signal — `kill`, not `kill -0` — aimed at a PID whose
// liveness was established by a `kill -0` probe moments earlier. That gap is a
// TOCTOU: between probe and signal the grandchild can exit and the OS can hand
// its number to something else, at which point the driver terminates an
// UNRELATED process on the operator's machine. `kill -0` liveness is not
// identity, and nothing downstream re-checks.
//
// Both drivers already carry a `**Residual risk — PID reuse.**` paragraph, but
// it reasons about the POLLING loop only — where a recycled PID genuinely IS
// benign (the poll just keeps polling a while longer). Nothing extends that
// framing to the destructive reap this milestone added, so the paragraph now
// reads as a blanket "PID reuse is harmless" claim directly above an
// instruction for which it is false.
//
// Two things have to close, and both are satisfiable by an IN-CLAUSE prose
// edit — one sentence added ahead of the reap sentence, one clause added to the
// existing residual-risk paragraph. No section or paragraph boundary moves, and
// nothing is deleted.
//
// SINGLE-ANCHOR HAZARD: `instructionOffset` returns -1 when MORE THAN ONE
// sentence carries an anchor, so the added identity sentence must not read as a
// second reap instruction — it must not repeat `rm -f <pidfile glob>`. The
// "each locatable as a single instruction" drift guards above are what name
// that failure if it happens.

/** The identity check: a `ps`-based confirmation the PID is a `claude` process. */
function carriesIdentityCheckInstruction(sentence: string): boolean {
  return /\bps\b\s+-[a-zA-Z]/.test(sentence) && /\bclaude\b/i.test(sentence);
}

/**
 * The reap paragraph mandates an identity check on the recorded PIDs: a
 * `ps`-based command lookup naming `claude` as the expected process, framed as
 * an identity question, co-located with the real (non-`kill -0`) signal it
 * gates. Paragraph-scoped — the SKILL's own reap clause, not the whole file.
 */
function requiresProcessIdentityCheckBeforeSignal(clause: string): boolean {
  return someParagraphMatches(proseOnly(clause), [
    /\bps\b\s+-[a-zA-Z]/,
    /\bclaude\b/i,
    /identit/i,
    /\bkill\b(?!\s*-\s*0\b)/i,
  ]);
}

/**
 * The identity check is positioned ahead of the reap's real signal — same
 * offset discipline as `reapPrecedesDestructiveTeardown`, because prose order
 * is what a driver reads as execution order. A check stated after the kill is
 * not a check.
 */
function identityCheckPrecedesReap(clause: string, pidGlob: string): boolean {
  const identityAt = instructionOffset(clause, carriesIdentityCheckInstruction);
  const reapAt = instructionOffset(clause, (sentence) =>
    carriesReapInstruction(sentence, pidGlob),
  );
  if (identityAt < 0 || reapAt < 0) return false;
  if (identityAt !== reapAt) return identityAt < reapAt;
  // Both merged into ONE sentence ("confirm `ps -p <pid> -o comm=` reports
  // `claude`, then `kill` it and `rm -f …`") is a legal fix, so compare token
  // offsets inside that sentence rather than declaring a tie a failure.
  const sentence = flatProse(clause).slice(identityAt);
  const identityToken = sentence.search(/\bps\b\s+-[a-zA-Z]/);
  const signalToken = sentence.search(/\bkill\b(?!\s*-\s*0\b)/i);
  return identityToken >= 0 && signalToken >= 0 && identityToken < signalToken;
}

/** The `**Residual risk — PID reuse.**` paragraph, in either driver. */
function pidReuseResidualRiskClause(region: string): string {
  return boldClause(region, "**Residual risk — PID reuse");
}

/**
 * The PID-reuse framing reaches the DESTRUCTIVE reap, not just the poll: a
 * recycled PID there takes a real signal aimed at a process that is not this
 * run's. Accepted in either the residual-risk paragraph or the reap clause —
 * the AC cares that the framing exists somewhere it governs the kill, not which
 * of the two paragraphs carries it.
 */
function extendsPidReuseFramingToDestructiveReap(clause: string): boolean {
  return someParagraphMatches(proseOnly(clause), [
    /recycled|PID reuse|reused PID/i,
    /\breap\b|destructive/i,
    /real signal|actual signal|SIGTERM|terminat/i,
    /unrelated|another process|someone else|a different process/i,
  ]);
}

/**
 * The surviving "negligible / benign" claim is SCOPED to the poll rather than
 * left as a blanket statement about PID reuse. Sentence-level on purpose: the
 * defect is that one sentence reads as universal absolution, and adding a
 * qualifying sentence elsewhere in the paragraph does not retract it — the
 * scoping has to live in a sentence that itself makes the benign claim.
 */
function scopesBenignFramingToThePoll(clause: string): boolean {
  return proseSentences(clause).some(
    (sentence) =>
      /\b(negligible|benign)\b/i.test(sentence) &&
      /\bpoll/i.test(sentence) &&
      /\bonly\b/i.test(sentence),
  );
}

const AUTO_APPROVE_MARKER = "<dpt:auto-approve>v1</dpt:auto-approve>";

// The bounded multi-iteration poll shape (STE-365.3 drift guard).
const BOUNDED_LOOP_RE = /for \w+ in \$\(seq 1 18\)/;

// ---------------------------------------------------------------------------
// AC-STE-414.1 — SMOKE-CTX probe restated as a HARD GATE
// ---------------------------------------------------------------------------

describeIfPresent(
  "AC-STE-414.1 — /smoke-test: SMOKE-CTX is a hard gate, not an advisory banner",
  () => {
    test("the Phase-2-entry context-probe subsection still exists and still runs the [ -t 0 ] probe", () => {
      const section = smokeCtxSection(skill!);
      expect(section.length).toBeGreaterThan(0);
      expect(section).toContain("[ -t 0 ]");
      expect(section).toContain("SMOKE-CTX: headless");
    });

    test("SKILL prose states the [ -t 0 ] result is the SOLE determinant and a headless classification is BINDING", () => {
      // proseOnly: the AC requires this in SKILL prose, so widening the echo
      // string inside the probe fence must NOT satisfy it.
      expect(
        statesBindingHeadlessClassification(proseOnly(smokeCtxSection(skill!))),
      ).toBe(true);
    });

    test("SKILL prose byte-pins `interactive parent` as the forbidden self-classification", () => {
      const prose = proseOnly(smokeCtxSection(skill!));
      expect(prose).toMatch(/interactive parent/i);
      expect(forbidsInteractiveParentSelfNarration(prose)).toBe(true);
    });

    test("the hard gate says the classification cannot be overridden by self-narration", () => {
      expect(
        someParagraphMatches(proseOnly(smokeCtxSection(skill!)), [
          /binding|BINDING/,
          /overrid/i,
          /self-narrat|narrat/i,
        ]),
      ).toBe(true);
    });
  },
);

// ---------------------------------------------------------------------------
// AC-STE-414.2 — all four escape paths forbidden together at the spawn site
// ---------------------------------------------------------------------------

describeIfPresent(
  "AC-STE-414.2 — /smoke-test: one co-located paragraph forbids all four grandchild-wait escapes",
  () => {
    test("the child-spawn-discipline subsection still carries a ⛔ FORBIDDEN callout", () => {
      const section = childSpawnDisciplineSection(skill!);
      expect(section.length).toBeGreaterThan(0);
      expect(section).toMatch(/⛔|FORBIDDEN/);
    });

    test("ONE paragraph names run_in_background + Monitor + background-completion wait + turn-yield + `interactive parent` + the only-sanctioned wait", () => {
      expect(
        someParagraphMatches(childSpawnDisciplineSection(skill!), [
          /⛔|FORBIDDEN/,
          /run_in_background/,
          /\bMonitor\b/,
          /completion notification|background-task completion|background completion/i,
          /ending the turn|end the turn|turn-yield/i,
          /interactive parent/i,
          /only sanctioned wait|ONLY sanctioned wait/i,
          /kill -0/,
        ]),
      ).toBe(true);
    });

    // --- drift guard (STE-365.3 carry-forward) --------------------------------
    // These three assertions are GREEN before implementation BY DESIGN: the fix
    // must not delete the spawn/poll pattern the FORBIDDEN callout protects.
    test("drift guard: the bounded kill-0 poll snippet survives (seq 1 18 + kill -0 + sleep 30 + .pid)", () => {
      const pollFence = bashFences(grandchildMachinery(skill!)).find(
        (fence) => fence.includes("kill -0") && fence.includes(".pid"),
      );
      expect(pollFence).toBeDefined();
      expect(pollFence!).toMatch(BOUNDED_LOOP_RE);
      expect(pollFence!).toContain("sleep 30");
    });

    test("drift guard: the detached-spawn + pidfile-capture snippet survives (`&` + `echo $! >` + .pid)", () => {
      const section = childSpawnDisciplineSection(skill!);
      const spawnFence = bashFences(section).find(
        (fence) =>
          fence.includes("&") &&
          /echo \$! >/.test(fence) &&
          fence.includes(".pid"),
      );
      expect(spawnFence).toBeDefined();
    });

    test("drift guard: the poll clause still names the bounded poll as the only sanctioned wait", () => {
      expect(grandchildMachinery(skill!)).toMatch(/only sanctioned wait/i);
    });
  },
);

// ---------------------------------------------------------------------------
// AC-STE-414.3 — discretionary-halt guard (the previously uncovered escape)
// ---------------------------------------------------------------------------

describeIfPresent(
  "AC-STE-414.3 — /smoke-test: discretionary-halt guard resolves judgment calls off the marker",
  () => {
    test("a `#### Discretionary-halt guard` subsection exists", () => {
      expect(discretionaryHaltSection(skill!).length).toBeGreaterThan(0);
    });

    test("the guard routes on the byte-checkable auto-approve marker literal", () => {
      expect(discretionaryHaltSection(skill!)).toContain(AUTO_APPROVE_MARKER);
    });

    test("branch 1 — marker present ⇒ proceed with the full run", () => {
      expect(
        statesMarkerPresentProceeds(proseOnly(discretionaryHaltSection(skill!))),
      ).toBe(true);
    });

    test("branch 2 — marker absent ⇒ abort with full teardown", () => {
      expect(
        statesMarkerAbsentAbortsWithTeardown(
          proseOnly(discretionaryHaltSection(skill!)),
        ),
      ).toBe(true);
    });

    test("the guard states plainly that no prose-ask-then-end-turn path exists under non-tty", () => {
      expect(
        forbidsProseAskThenEndTurn(proseOnly(discretionaryHaltSection(skill!))),
      ).toBe(true);
    });

    test("the guard names the concrete judgment-call categories that stranded the 2026-07-24 Linear leg", () => {
      const section = discretionaryHaltSection(skill!);
      expect(section).toMatch(/rate[- ]limit/i);
      expect(section).toMatch(/cost pause|reduced[- ]run/i);
    });
  },
);

// ---------------------------------------------------------------------------
// AC-STE-414.4 — final-message self-check becomes a hard abort-with-teardown
// ---------------------------------------------------------------------------

describeIfPresent(
  "AC-STE-414.4 — /smoke-test: end-of-turn self-check aborts, never exits rc=0 silently",
  () => {
    test("the final-message self-check clause still exists inside the grandchild-spawn machinery", () => {
      const clause = finalMessageSelfCheckClause(grandchildMachinery(skill!));
      expect(clause.length).toBeGreaterThan(0);
      expect(clause).toMatch(/pidfile/i);
    });

    test("the clause is a hard abort-with-teardown that never exits rc=0 silently", () => {
      expect(
        isHardAbortWithTeardown(
          finalMessageSelfCheckClause(grandchildMachinery(skill!)),
        ),
      ).toBe(true);
    });

    test("both triggers are named — an incomplete grandchild chain OR a live pidfile", () => {
      expect(
        namesBothEndOfTurnTriggers(
          finalMessageSelfCheckClause(grandchildMachinery(skill!)),
        ),
      ).toBe(true);
    });

    test("the `[~]` runtime-deferred posture is retired out of the self-check clause", () => {
      const clause = finalMessageSelfCheckClause(grandchildMachinery(skill!));
      expect(clause).not.toContain("[~]");
      expect(clause).not.toMatch(/ships deferred|runtime.deferred/i);
    });

    // --- the surviving rc=0 loophole (audit: AC-STE-414.4 = Partial) --------
    // "Loud abort + teardown" is fully satisfiable while the process still
    // exits 0, and the prohibition is qualified by "silently". Both halves have
    // to close or the parent keeps reading rc=0 off a void leg.
    test("the abort branch mandates a NON-ZERO exit, not merely a loud message", () => {
      expect(
        mandatesNonZeroExitOnAbort(
          finalMessageSelfCheckClause(grandchildMachinery(skill!)),
        ),
      ).toBe(true);
    });

    test("the never-rc=0 rule is stated UNQUALIFIED — it does not hinge on the word `silently`", () => {
      expect(
        statesUnqualifiedNeverRcZero(
          finalMessageSelfCheckClause(grandchildMachinery(skill!)),
        ),
      ).toBe(true);
    });

    // --- the unachievable invariant (audit: AC-STE-414.4/.5) ----------------
    test("the abort branch reaps — kills the live pidfile PIDs and `rm -f`s the pidfiles before the turn ends", () => {
      expect(
        reapsLivePidfilesOnAbort(
          finalMessageSelfCheckClause(grandchildMachinery(skill!)),
          "/tmp/dpt-smoke-<tracker>-*.pid",
        ),
      ).toBe(true);
    });

    test("drift guard: the `no third branch` invariant is made true, not deleted", () => {
      expect(
        keepsNoThirdBranchInvariant(
          finalMessageSelfCheckClause(grandchildMachinery(skill!)),
        ),
      ).toBe(true);
    });

    // --- the reap/teardown RACE (contract 5b) -------------------------------
    // Contract 5 is order-blind, so it went green on prose that reaps AFTER
    // Phase 5 has already archived the tracker project and `rm -rf`d the test
    // directory — with the grandchild still live inside both.
    test("drift guard: the reap and the destructive teardown are each locatable as a single instruction", () => {
      // Non-vacuity for the ordering assertion below: if either anchor stopped
      // resolving, `reapPrecedesDestructiveTeardown` would report false, so this
      // test names WHICH half went missing instead of leaving a bare ordering
      // failure to interpret.
      const clause = finalMessageSelfCheckClause(grandchildMachinery(skill!));
      expect(
        instructionOffset(clause, (sentence) =>
          carriesReapInstruction(sentence, "/tmp/dpt-smoke-<tracker>-*.pid"),
        ),
      ).toBeGreaterThanOrEqual(0);
      expect(
        instructionOffset(clause, carriesDestructiveTeardownInstruction),
      ).toBeGreaterThanOrEqual(0);
    });

    test("the reap is instructed BEFORE the destructive Phase 5 teardown, not after it", () => {
      expect(
        reapPrecedesDestructiveTeardown(
          finalMessageSelfCheckClause(grandchildMachinery(skill!)),
          "/tmp/dpt-smoke-<tracker>-*.pid",
        ),
      ).toBe(true);
    });

    test("the reap instruction does not sequence itself after the teardown actions", () => {
      expect(
        reapNotSequencedAfterTeardown(
          finalMessageSelfCheckClause(grandchildMachinery(skill!)),
          "/tmp/dpt-smoke-<tracker>-*.pid",
        ),
      ).toBe(true);
    });

    // --- the reap's PID-reuse TOCTOU (contract 5c) --------------------------
    // Contracts 5/5b got the reap in place and in the right order; neither says
    // anything about WHICH process gets the signal. The pidfile PID was proven
    // live by `kill -0`, not proven to be this run's grandchild, so a PID
    // recycled in between takes a real `kill` meant for someone else.
    test("drift guard: the process-identity check is locatable as a single instruction", () => {
      // Non-vacuity for the ordering assertion below — the same posture as the
      // reap/teardown drift guard: name WHICH anchor stopped resolving instead
      // of leaving a bare ordering failure to interpret.
      expect(
        instructionOffset(
          finalMessageSelfCheckClause(grandchildMachinery(skill!)),
          carriesIdentityCheckInstruction,
        ),
      ).toBeGreaterThanOrEqual(0);
    });

    test("the reap confirms the recorded PID is a `claude` process before signalling it, not merely that it answers `kill -0`", () => {
      expect(
        requiresProcessIdentityCheckBeforeSignal(
          finalMessageSelfCheckClause(grandchildMachinery(skill!)),
        ),
      ).toBe(true);
    });

    test("the identity check is instructed BEFORE the real `kill`, not after it", () => {
      expect(
        identityCheckPrecedesReap(
          finalMessageSelfCheckClause(grandchildMachinery(skill!)),
          "/tmp/dpt-smoke-<tracker>-*.pid",
        ),
      ).toBe(true);
    });

    test("drift guard: the `Residual risk — PID reuse` paragraph survives and still explains `kill -0` liveness", () => {
      const residual = pidReuseResidualRiskClause(grandchildMachinery(skill!));
      expect(residual.length).toBeGreaterThan(0);
      expect(residual).toContain("kill -0");
    });

    test("the PID-reuse framing is extended to the DESTRUCTIVE reap, not left scoped to the poll's consequence", () => {
      const machinery = grandchildMachinery(skill!);
      expect(
        extendsPidReuseFramingToDestructiveReap(
          pidReuseResidualRiskClause(machinery),
        ) ||
          extendsPidReuseFramingToDestructiveReap(
            finalMessageSelfCheckClause(machinery),
          ),
      ).toBe(true);
    });

    test("the `negligible` framing is scoped to the poll — PID reuse no longer reads as uniformly benign", () => {
      expect(
        scopesBenignFramingToThePoll(
          pidReuseResidualRiskClause(grandchildMachinery(skill!)),
        ),
      ).toBe(true);
    });
  },
);

// ---------------------------------------------------------------------------
// AC-STE-414.5 — every abort path routes through Phase 5 teardown.
// THREE separate per-clause assertions: a single global "teardown" mention in
// the file must NOT be able to satisfy all three. This is the non-vacuity
// centrepiece of the file.
// ---------------------------------------------------------------------------

describeIfPresent(
  "AC-STE-414.5 — /smoke-test: each of the three abort clauses routes through Phase 5 teardown",
  () => {
    test("abort path 1/3 — the headless-gate violation clause references Phase 5 teardown", () => {
      expect(
        someParagraphMatches(proseOnly(smokeCtxSection(skill!)), [
          /abort/i,
          /teardown/i,
          /Phase 5/,
        ]),
      ).toBe(true);
    });

    test("abort path 2/3 — the discretionary no-marker halt clause references Phase 5 teardown", () => {
      expect(
        someParagraphMatches(proseOnly(discretionaryHaltSection(skill!)), [
          /abort/i,
          /teardown/i,
          /Phase 5/,
        ]),
      ).toBe(true);
    });

    test("abort path 3/3 — the end-of-turn incomplete-chain clause references Phase 5 teardown", () => {
      // proseOnly for symmetry with paths 1/3 and 2/3 above: this clause has a
      // co-located ```bash self-check fence, and the file's contract is that a
      // routing the AC states in SKILL *prose* must not be satisfiable by an
      // echo string inside a fence.
      expect(
        someParagraphMatches(
          proseOnly(finalMessageSelfCheckClause(grandchildMachinery(skill!))),
          [/abort/i, /teardown/i, /Phase 5/],
        ),
      ).toBe(true);
    });

    // Drift guard — GREEN before implementation BY DESIGN: the abort target
    // must keep doing what the AC promises it does (archive/close the tracker
    // project + remove the test directory), or the three routings above are
    // routing to nothing.
    test("drift guard: Phase 5 still archives/closes the tracker project and removes the test directory", () => {
      const phase5 = phase5Section(skill!);
      expect(phase5.length).toBeGreaterThan(0);
      expect(phase5).toContain("rm -rf ../dpt-test-project-linear");
      expect(phase5).toContain("rm -rf ../dpt-test-project-jira");
      expect(phase5).toContain("mcp__linear__save_project");
      expect(phase5).toContain("transitionJiraIssue");
    });
  },
);

// ---------------------------------------------------------------------------
// AC-STE-414.6 — parity: the same three contract clauses in /conformance-loop
// ---------------------------------------------------------------------------

describeIfConformanceLoopPresent(
  "AC-STE-414.6 — /conformance-loop: hard-gate + discretionary-halt + abort-with-teardown parity",
  () => {
    test("Phase A carries the [ -t 0 ] headless probe", () => {
      const phaseA = phaseASlice(conformanceLoop!);
      expect(phaseA.length).toBeGreaterThan(0);
      expect(phaseA).toContain("[ -t 0 ]");
    });

    test("hard gate mirrored — SOLE determinant + BINDING classification", () => {
      expect(
        statesBindingHeadlessClassification(
          proseOnly(phaseASlice(conformanceLoop!)),
        ),
      ).toBe(true);
    });

    test("hard gate mirrored — `interactive parent` self-narration byte-pinned as forbidden", () => {
      const prose = proseOnly(phaseASlice(conformanceLoop!));
      expect(prose).toMatch(/interactive parent/i);
      expect(forbidsInteractiveParentSelfNarration(prose)).toBe(true);
    });

    test("discretionary-halt guard mirrored — marker present ⇒ proceed", () => {
      expect(
        statesMarkerPresentProceeds(proseOnly(phaseASlice(conformanceLoop!))),
      ).toBe(true);
    });

    test("discretionary-halt guard mirrored — marker absent ⇒ abort with full teardown", () => {
      expect(
        statesMarkerAbsentAbortsWithTeardown(
          proseOnly(phaseASlice(conformanceLoop!)),
        ),
      ).toBe(true);
    });

    test("discretionary-halt guard mirrored — no prose-ask-then-end-turn under non-tty", () => {
      expect(
        forbidsProseAskThenEndTurn(proseOnly(phaseASlice(conformanceLoop!))),
      ).toBe(true);
    });

    test("end-of-turn abort-with-teardown mirrored into the Phase A self-check clause", () => {
      const clause = finalMessageSelfCheckClause(
        phaseASlice(conformanceLoop!),
      );
      expect(clause.length).toBeGreaterThan(0);
      expect(isHardAbortWithTeardown(clause)).toBe(true);
      expect(namesBothEndOfTurnTriggers(clause)).toBe(true);
      expect(clause).not.toContain("[~]");
    });

    // --- rc=0 loophole + unachievable invariant, mirrored -------------------
    // /conformance-loop is the OUTER driver: its own rc=0 is what the operator
    // reads, and the 2026-07-24 run is exactly the case where a loud-but-zero
    // exit reads as a clean run. Same predicates as the smoke-test side, so
    // parity is byte-pinned by shared code rather than a re-typed near-copy.
    test("the Phase A abort branch mandates a NON-ZERO exit, not merely a loud LOOP-ABORT line", () => {
      expect(
        mandatesNonZeroExitOnAbort(
          finalMessageSelfCheckClause(phaseASlice(conformanceLoop!)),
        ),
      ).toBe(true);
    });

    test("the Phase A never-rc=0 rule is stated UNQUALIFIED — it does not hinge on the word `silently`", () => {
      expect(
        statesUnqualifiedNeverRcZero(
          finalMessageSelfCheckClause(phaseASlice(conformanceLoop!)),
        ),
      ).toBe(true);
    });

    test("the Phase A abort branch reaps — kills the live leg PIDs and `rm -f`s `/tmp/dpt-conformance-loop-*.pid`", () => {
      expect(
        reapsLivePidfilesOnAbort(
          finalMessageSelfCheckClause(phaseASlice(conformanceLoop!)),
          "/tmp/dpt-conformance-loop-*.pid",
        ),
      ).toBe(true);
    });

    test("drift guard: the Phase A `no third branch` invariant is made true, not deleted", () => {
      expect(
        keepsNoThirdBranchInvariant(
          finalMessageSelfCheckClause(phaseASlice(conformanceLoop!)),
        ),
      ).toBe(true);
    });

    // --- the reap/teardown RACE, mirrored -----------------------------------
    // /conformance-loop runs the per-leg teardown for BOTH legs, so an
    // out-of-order abort here archives two tracker projects and `rm -rf`s two
    // test directories out from under legs that may still be mid-chain. Same
    // shared predicates as the smoke-test side, so parity is pinned by common
    // code rather than a re-typed near-copy.
    test("drift guard: the Phase A reap and per-leg teardown are each locatable as a single instruction", () => {
      const clause = finalMessageSelfCheckClause(phaseASlice(conformanceLoop!));
      expect(
        instructionOffset(clause, (sentence) =>
          carriesReapInstruction(sentence, "/tmp/dpt-conformance-loop-*.pid"),
        ),
      ).toBeGreaterThanOrEqual(0);
      expect(
        instructionOffset(clause, carriesDestructiveTeardownInstruction),
      ).toBeGreaterThanOrEqual(0);
    });

    test("the Phase A reap is instructed BEFORE the destructive per-leg teardown", () => {
      expect(
        reapPrecedesDestructiveTeardown(
          finalMessageSelfCheckClause(phaseASlice(conformanceLoop!)),
          "/tmp/dpt-conformance-loop-*.pid",
        ),
      ).toBe(true);
    });

    test("the Phase A reap instruction does not sequence itself after the teardown actions", () => {
      expect(
        reapNotSequencedAfterTeardown(
          finalMessageSelfCheckClause(phaseASlice(conformanceLoop!)),
          "/tmp/dpt-conformance-loop-*.pid",
        ),
      ).toBe(true);
    });

    // --- the reap's PID-reuse TOCTOU, mirrored (contract 5c) ----------------
    // /conformance-loop reaps BOTH legs' pidfiles, so an identity-blind kill
    // here is two chances to signal an unrelated process. Same shared
    // predicates as the smoke-test side, so parity is pinned by common code
    // rather than a re-typed near-copy.
    test("drift guard: the Phase A process-identity check is locatable as a single instruction", () => {
      expect(
        instructionOffset(
          finalMessageSelfCheckClause(phaseASlice(conformanceLoop!)),
          carriesIdentityCheckInstruction,
        ),
      ).toBeGreaterThanOrEqual(0);
    });

    test("the Phase A reap confirms the recorded PID is a `claude` process before signalling it", () => {
      expect(
        requiresProcessIdentityCheckBeforeSignal(
          finalMessageSelfCheckClause(phaseASlice(conformanceLoop!)),
        ),
      ).toBe(true);
    });

    test("the Phase A identity check is instructed BEFORE the real `kill`", () => {
      expect(
        identityCheckPrecedesReap(
          finalMessageSelfCheckClause(phaseASlice(conformanceLoop!)),
          "/tmp/dpt-conformance-loop-*.pid",
        ),
      ).toBe(true);
    });

    test("drift guard: the Phase A `Residual risk — PID reuse` paragraph survives and still explains `kill -0` liveness", () => {
      const residual = pidReuseResidualRiskClause(phaseASlice(conformanceLoop!));
      expect(residual.length).toBeGreaterThan(0);
      expect(residual).toContain("kill -0");
    });

    test("the Phase A PID-reuse framing is extended to the DESTRUCTIVE reap", () => {
      const phaseA = phaseASlice(conformanceLoop!);
      expect(
        extendsPidReuseFramingToDestructiveReap(
          pidReuseResidualRiskClause(phaseA),
        ) ||
          extendsPidReuseFramingToDestructiveReap(
            finalMessageSelfCheckClause(phaseA),
          ),
      ).toBe(true);
    });

    test("the Phase A `negligible` framing is scoped to the poll — PID reuse no longer reads as uniformly benign", () => {
      expect(
        scopesBenignFramingToThePoll(
          pidReuseResidualRiskClause(phaseASlice(conformanceLoop!)),
        ),
      ).toBe(true);
    });
  },
);
