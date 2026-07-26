// Post-release defect backfill against the shipped M112/M113/M114 branch —
// the two project-local driver SKILL.mds at repo root (`.claude/skills/`).
//
// An independent verification pass over the release branch returned SHIP with
// no blockers but named two accuracy/coverage defects this branch CAUSED. Both
// live in prose that an LLM driver executes, so both are pinned here rather
// than left to review memory.
//
// ---------------------------------------------------------------------------
// DEFECT A — reap-parity gap.
//
// STE-414's audit round added a "reap before destructive teardown" instruction
// (identity-check each recorded PID with `ps -p <pid> -o comm=`, `kill` it,
// `rm -f` the pidfile glob) — but ONLY to the `**Final-message self-check**`
// clause. Each driver has THREE abort clauses, and the other two still route
// straight to teardown with no reap:
//
//   * `**Headless-gate violation ⇒ abort with full teardown.**`
//   * `**Branch 2 — marker absent ⇒ abort with full teardown.**`
//
// Both say "run `### Phase 5 — Teardown` (archive/close the tracker project +
// `rm -rf` the test directory)". That is the SAME race contract 5b closed on
// the third clause: `rm -rf` runs while a spawned grandchild / leg may still be
// live and writing into the directory being removed, and still posting to the
// project being archived. A fix on one of three sanctioned abort paths is not a
// fix — the two unfixed paths are the ones a hard-gate violation and a
// missing-marker halt actually take.
//
// Either shape closes it: carry the reap instruction in-clause, or explicitly
// cross-reference the `Final-message self-check` clause's reap-first rule. The
// predicates below accept BOTH — triplicating the full `ps` + `kill` + `rm -f`
// recipe into three clauses is worse prose, and a named cross-reference is
// unambiguous to a driver executing the clause.
//
// *** SLICE HAZARD (why every assertion here is paragraph-scoped). ***
// `tests/m112-ste-414-nontty-hard-gate.test.ts` carries five predicates built
// on `instructionOffset`, which returns -1 when MORE THAN ONE sentence in its
// slice matches an anchor role: `reapsLivePidfilesOnAbort`,
// `reapPrecedesDestructiveTeardown`, `reapNotSequencedAfterTeardown`,
// `carriesIdentityCheckInstruction` / `identityCheckPrecedesReap`. A second
// reap-shaped or teardown-shaped sentence inside THEIR slice turns those
// currently-green assertions red.
//
// Those five all read exactly one slice per driver:
//   smoke-test      → boldClause(§ Grandchild spawn lifecycle, "**Final-message self-check")
//   conformance-loop → boldClause(§ Phase A,                    "**Final-message self-check")
//
// The two clauses THIS file targets live in different regions entirely
// (§ Phase-2-entry context probe and § Discretionary-halt guard on the
// smoke side; the same two `####` subsections inside § Phase A on the loop
// side), and every assertion below slices to the single blank-line-delimited
// PARAGRAPH the clause occupies. So the text a fix adds lands outside every
// offset-predicate slice by construction. `boldParagraph` — not `boldClause` —
// is what guarantees that: `boldClause` would run from the headless-gate
// paragraph all the way to the next `####` heading (past the whole spawn
// bullet list), and a fix could then satisfy the contract from 40 lines away.
//
// ---------------------------------------------------------------------------
// DEFECT B — a false rationale contradicting the same clause.
//
// The non-zero-exit mandate justifies itself with "because rc=0 is the only
// signal the parent/operator actually reads". The SAME document refutes that:
// /conformance-loop's `**Leg-completeness check**` opens "RC 0 alone is not
// proof a leg ran its chain" and then verifies the per-skill log set, and the
// self-check clause's OWN second paragraph opens "Exiting rc=0 is not proof the
// chain ran".
//
// A self-contradicting rationale is precisely what an LLM driver resolves in
// its own favour — the failure mode STE-414 exists to close. If rc really were
// the only signal read, the leg-completeness check would be dead code and the
// driver could reason its way out of running it. So the rationale must be
// consistent with the check: rc=0 is necessary-but-not-sufficient / one of
// several corroborating signals / a false green must not be reported in the
// exit code.
//
// The mandate itself is NOT the target — `mandatesNonZeroExitOnAbort` and
// `statesUnqualifiedNeverRcZero` in the m112 file keep it pinned, and both are
// paragraph/sentence-existential, so rewriting the `because …` sub-clause in
// place cannot disturb them.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..", "..");
const smokePath = join(repoRoot, ".claude", "skills", "smoke-test", "SKILL.md");
const loopPath = join(
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
// the suite skips cleanly instead of failing. Same idiom as the m112 file.
const smoke = readIfPresent(smokePath);
const loop = readIfPresent(loopPath);
const describeIfSmoke = smoke === null ? describe.skip : describe;
const describeIfLoop = loop === null ? describe.skip : describe;

// ---------------------------------------------------------------------------
// Slicing helpers (kept local so `tests/m112-ste-414-nontty-hard-gate.test.ts`
// stays byte-unmodified — importing a bun:test file would re-register its 56
// assertions in this file's run).
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

/** A `####`-level subsection, fence-aware, up to the next heading of any level. */
function subsection(body: string, startsWith: string): string {
  const lines = body.split("\n");
  const start = lines.findIndex((line) => line.startsWith(startsWith));
  if (start === -1) return "";
  let inFence = false;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i]!.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^#{2,6} /.test(lines[i]!)) return lines.slice(start, i).join("\n");
  }
  return lines.slice(start).join("\n");
}

/**
 * The single blank-line-delimited PARAGRAPH a bold-lead clause occupies.
 *
 * Deliberately tighter than the m112 file's `boldClause`: see the SLICE HAZARD
 * note in the header. It also enforces the "no paragraph boundary may move"
 * constraint — a fix has to edit the clause, not append a neighbouring one.
 */
function boldParagraph(body: string, leadIn: string): string {
  const lines = body.split("\n");
  const start = lines.findIndex((line) => line.startsWith(leadIn));
  if (start === -1) return "";
  let end = start + 1;
  while (end < lines.length && lines[end]!.trim() !== "") end++;
  return lines.slice(start, end).join("\n");
}

/** A bold-lead clause up to the next bold-lead line or heading (m112 shape). */
function boldClause(body: string, leadIn: string): string {
  const lines = body.split("\n");
  const start = lines.findIndex((line) => line.startsWith(leadIn));
  if (start === -1) return "";
  let inFence = false;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i]!.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^#{2,6} /.test(lines[i]!)) return lines.slice(start, i).join("\n");
    if (/^\*\*[^*\n]+\*\*/.test(lines[i]!) && !lines[i]!.startsWith(leadIn)) {
      return lines.slice(start, i).join("\n");
    }
  }
  return lines.slice(start).join("\n");
}

/** Drop fenced blocks so an echo string inside a probe cannot satisfy prose. */
function proseOnly(section: string): string {
  return section.replace(/```[a-z]*\n[\s\S]*?```/g, "\n\n");
}

function flatProse(clause: string): string {
  return proseOnly(clause).replace(/\n+/g, " ");
}

function proseSentences(clause: string): string[] {
  return flatProse(clause).split(/(?<=[.!?])\s+/);
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// --- region accessors -------------------------------------------------------

const SMOKE_CTX = "#### Phase-2-entry context probe";
const LOOP_CTX = "#### Phase-A-entry context probe";
const HALT_GUARD = "#### Discretionary-halt guard";
const GRANDCHILD = "#### Grandchild spawn lifecycle";
const HEADLESS_ABORT = "**Headless-gate violation";
const NO_MARKER_ABORT = "**Branch 2";
const SELF_CHECK = "**Final-message self-check";

function phaseASlice(body: string): string {
  return sectionSlice(
    body,
    "### Phase A — Parallel /smoke-test fan-out + aggregation",
    "## Findings",
  );
}

// ---------------------------------------------------------------------------
// DEFECT A predicates
// ---------------------------------------------------------------------------

const REAP_RE = /\breap\w*\b/i;
const TEARDOWN_RE = /teardown|tear down|Phase 5/i;
const ORDERING_RE = /\b(?:before|first|ahead of|prior to|then|precede\w*|once)\b/i;

/**
 * The literal defect phrasing to reject: sequencing the reap AFTER teardown.
 * Window-limited (`after` + ≤3 plain words + `teardown`) exactly as the m112
 * file's twin does, so a correct fix reading "only after that reap may the
 * driver run `### Phase 5 — Teardown`" is NOT caught — the em dash and the
 * backticked heading break the word run.
 */
const REAP_SEQUENCED_AFTER_TEARDOWN_RE =
  /\bafter\s+(?:[\w-]+\s+){0,3}teardown\b/i;

/** One sentence that puts the reap ahead of the destructive teardown. */
function sentenceOrdersReapAheadOfTeardown(sentence: string): boolean {
  return (
    REAP_RE.test(sentence) &&
    ORDERING_RE.test(sentence) &&
    TEARDOWN_RE.test(sentence)
  );
}

/**
 * The clause orders the reap ahead of the teardown, and no sentence that does
 * so sequences it the wrong way round. Paragraph-scoped and satisfiable by ONE
 * added in-clause sentence.
 */
function ordersReapBeforeTeardown(clause: string): boolean {
  const hits = proseSentences(clause).filter(sentenceOrdersReapAheadOfTeardown);
  return (
    hits.length > 0 &&
    hits.every((s) => !REAP_SEQUENCED_AFTER_TEARDOWN_RE.test(s))
  );
}

/**
 * The reap the clause orders is ACTIONABLE — the driver can execute it without
 * inventing the recipe. Two legal shapes:
 *
 *   (a) cross-reference — names the `Final-message self-check` clause, whose
 *       reap-first rule already carries the identity check + `kill` + `rm -f`;
 *   (b) inline — carries a real (non-`kill -0`) `kill` plus `rm -f <pidglob>`.
 *
 * `kill -0` is excluded from the kill pattern deliberately: a liveness probe is
 * not a reap.
 */
function reapIsActionable(clause: string, pidGlob: string): boolean {
  const crossReferencesTheReapRule = /Final-message self-check/i.test(clause);
  const carriesTheRecipeInline =
    /\bkill\b(?!\s*-\s*0\b)/i.test(clause) &&
    new RegExp("\\brm -f " + escapeRegExp(pidGlob)).test(clause);
  return crossReferencesTheReapRule || carriesTheRecipeInline;
}

// ---------------------------------------------------------------------------
// DEFECT B predicates
// ---------------------------------------------------------------------------

/** The sentence carrying the non-zero-exit mandate (the rationale's host). */
function nonZeroMandateSentence(clause: string): string | undefined {
  return proseSentences(clause).find(
    (s) =>
      /\babort/i.test(s) &&
      /\bMUST\b/.test(s) &&
      /\bexits?\b[^.\n]{0,40}\bnon-?zero\b|\bnon-?zero\b[^.\n]{0,40}\bexit/i.test(
        s,
      ),
  );
}

/** The blank-line paragraph that hosts the non-zero-exit mandate. */
function mandateParagraph(clause: string): string {
  return (
    proseOnly(clause)
      .split(/\n\n+/)
      .find(
        (p) =>
          /\babort/i.test(p) && /\bMUST\b/.test(p) && /non-?zero/i.test(p),
      ) ?? ""
  );
}

/** `only/sole <≤2 words> signal(s)` — the exclusivity claim itself. */
const ONLY_SIGNAL_RE = /\b(?:only|sole)\s+(?:\w+\s+){0,2}signals?\b/gi;
/** A negation immediately ahead of it ("… is NOT the only signal …") is fine. */
const NEGATED_AHEAD_RE = /\b(?:not|never|no longer|nor|hardly)\s+(?:the\s+)?$/i;

/**
 * A sentence claiming the exit code is the ONLY signal anyone reads. That is
 * the contradiction: the leg-completeness check reads the per-skill log set,
 * and the very next paragraph says rc=0 is not proof of anything.
 *
 * Negated forms are explicitly allowed — "rc=0 is not the only signal" is the
 * repair, not a repeat — and so is "only one of several signals" (three words
 * between `only` and `signals` puts it outside the {0,2} window).
 */
function claimsExitCodeIsTheOnlySignal(sentence: string): boolean {
  if (!/\brc\b|\brc\s*=\s*0\b|\bexit code\b|\bexit status\b/i.test(sentence)) {
    return false;
  }
  for (const match of sentence.matchAll(ONLY_SIGNAL_RE)) {
    const ahead = sentence.slice(Math.max(0, match.index - 24), match.index);
    if (NEGATED_AHEAD_RE.test(ahead)) continue;
    return true;
  }
  return false;
}

function anySentenceClaimsExitCodeIsTheOnlySignal(clause: string): boolean {
  return proseSentences(clause).some(claimsExitCodeIsTheOnlySignal);
}

/**
 * A rationale consistent with the leg-completeness check. Any of the standard
 * framings is accepted — the AC cares that the reason given is TRUE, not which
 * of the true reasons is picked.
 */
const CONSISTENT_RC_RATIONALE_RE = new RegExp(
  [
    "\\bnot the (?:only|sole)\\b",
    "\\bone of (?:several|multiple|two|the) \\w*\\s?signals?\\b",
    "\\bnecessary but not sufficient\\b",
    "\\bnot (?:proof|sufficient|enough) (?:on its own|by itself|alone)\\b",
    "\\balone is not (?:proof|sufficient|enough)\\b",
    "\\bcorroborat\\w*",
    "\\bfalse (?:green|success|pass|clean)\\b",
  ].join("|"),
  "i",
);

// ---------------------------------------------------------------------------
// DEFECT A — /smoke-test: all three abort clauses reap before teardown
// ---------------------------------------------------------------------------

describeIfSmoke(
  "Defect A — /smoke-test: every abort clause reaps before the destructive teardown",
  () => {
    const headlessAbort = () =>
      boldParagraph(subsection(smoke!, SMOKE_CTX), HEADLESS_ABORT);
    const noMarkerAbort = () =>
      boldParagraph(subsection(smoke!, HALT_GUARD), NO_MARKER_ABORT);
    const selfCheck = () =>
      boldClause(subsection(smoke!, GRANDCHILD), SELF_CHECK);
    const PID_GLOB = "/tmp/dpt-smoke-*.pid";

    // --- DISCRIMINATOR ------------------------------------------------------
    // The third abort clause already carries the reap-first rule (STE-414
    // contracts 5/5b/5c). It must satisfy both predicates today — otherwise the
    // two RED assertions below would be indistinguishable from an unmatchable
    // regex, and a "fix" could be graded against a contract nothing can meet.
    test("DISCRIMINATOR: the already-fixed final-message clause satisfies both predicates", () => {
      expect(ordersReapBeforeTeardown(selfCheck())).toBe(true);
      expect(reapIsActionable(selfCheck(), PID_GLOB)).toBe(true);
    });

    // --- abort clause 1/3 — headless-gate violation --------------------------
    test("slice sanity 1/3: the headless-gate clause is one paragraph that still routes to the destructive teardown", () => {
      const clause = headlessAbort();
      expect(clause.length).toBeGreaterThan(0);
      expect(clause).toMatch(/abort/i);
      expect(clause).toMatch(/rm -rf/);
      expect(clause).toMatch(/archive\/close/i);
      // Disjointness from the already-fixed third clause. Without this, a RED
      // failure below could not be told apart from a mis-aimed slice — and a
      // slice that reached the self-check clause would go green on prose this
      // clause does not carry.
      expect(clause).not.toContain("The abort MUST reap FIRST");
    });

    test("abort clause 1/3 — the headless-gate violation clause reaps before it tears down", () => {
      expect(ordersReapBeforeTeardown(headlessAbort())).toBe(true);
    });

    test("abort clause 1/3 — the reap it orders is actionable (inline recipe or a named cross-reference)", () => {
      expect(reapIsActionable(headlessAbort(), PID_GLOB)).toBe(true);
    });

    // --- abort clause 2/3 — discretionary no-marker halt ---------------------
    test("slice sanity 2/3: the no-marker Branch 2 clause is one paragraph that still routes to the destructive teardown", () => {
      const clause = noMarkerAbort();
      expect(clause.length).toBeGreaterThan(0);
      expect(clause).toMatch(/abort/i);
      expect(clause).toMatch(/rm -rf/);
      expect(clause).toMatch(/archive\/close/i);
      expect(clause).toMatch(/exit non-?zero/i);
      expect(clause).not.toContain("The abort MUST reap FIRST");
    });

    test("abort clause 2/3 — the no-marker halt clause reaps before it tears down", () => {
      expect(ordersReapBeforeTeardown(noMarkerAbort())).toBe(true);
    });

    test("abort clause 2/3 — the reap it orders is actionable (inline recipe or a named cross-reference)", () => {
      expect(reapIsActionable(noMarkerAbort(), PID_GLOB)).toBe(true);
    });

    // --- drift guard --------------------------------------------------------
    // GREEN before implementation BY DESIGN. The reap-first rule the other two
    // clauses may cross-reference has to keep existing under that exact name,
    // or the cross-reference form silently points at nothing.
    test("drift guard: the `Final-message self-check` clause keeps the name the cross-references depend on", () => {
      expect(subsection(smoke!, GRANDCHILD)).toContain(
        "**Final-message self-check",
      );
      expect(selfCheck()).toContain("rm -f " + PID_GLOB);
    });
  },
);

// ---------------------------------------------------------------------------
// DEFECT A parity — /conformance-loop mirrors of the same two clauses
// ---------------------------------------------------------------------------

describeIfLoop(
  "Defect A — /conformance-loop: every abort clause reaps before the destructive teardown",
  () => {
    const phaseA = () => phaseASlice(loop!);
    const headlessAbort = () =>
      boldParagraph(subsection(phaseA(), LOOP_CTX), HEADLESS_ABORT);
    const noMarkerAbort = () =>
      boldParagraph(subsection(phaseA(), HALT_GUARD), NO_MARKER_ABORT);
    const selfCheck = () => boldClause(phaseA(), SELF_CHECK);
    const PID_GLOB = "/tmp/dpt-conformance-loop-*.pid";

    test("DISCRIMINATOR: the already-fixed Phase A final-message clause satisfies both predicates", () => {
      expect(ordersReapBeforeTeardown(selfCheck())).toBe(true);
      expect(reapIsActionable(selfCheck(), PID_GLOB)).toBe(true);
    });

    test("slice sanity 1/2: the Phase A headless-gate clause is one paragraph that still routes to the per-leg teardown", () => {
      const clause = headlessAbort();
      expect(clause.length).toBeGreaterThan(0);
      expect(clause).toMatch(/abort/i);
      expect(clause).toMatch(/rm -rf/);
      expect(clause).toMatch(/archive\/close/i);
      expect(clause).not.toContain("The abort MUST reap FIRST");
    });

    test("abort clause 1/2 — the Phase A headless-gate clause reaps before it tears down", () => {
      expect(ordersReapBeforeTeardown(headlessAbort())).toBe(true);
    });

    test("abort clause 1/2 — the reap it orders is actionable (inline recipe or a named cross-reference)", () => {
      expect(reapIsActionable(headlessAbort(), PID_GLOB)).toBe(true);
    });

    test("slice sanity 2/2: the Phase A no-marker Branch 2 clause is one paragraph that still routes to the per-leg teardown", () => {
      const clause = noMarkerAbort();
      expect(clause.length).toBeGreaterThan(0);
      expect(clause).toMatch(/abort/i);
      expect(clause).toMatch(/rm -rf/);
      expect(clause).toMatch(/archive\/close/i);
      expect(clause).toMatch(/exit non-?zero/i);
      expect(clause).not.toContain("The abort MUST reap FIRST");
    });

    test("abort clause 2/2 — the Phase A no-marker halt clause reaps before it tears down", () => {
      expect(ordersReapBeforeTeardown(noMarkerAbort())).toBe(true);
    });

    test("abort clause 2/2 — the reap it orders is actionable (inline recipe or a named cross-reference)", () => {
      expect(reapIsActionable(noMarkerAbort(), PID_GLOB)).toBe(true);
    });

    test("drift guard: the Phase A `Final-message self-check` clause keeps the name the cross-references depend on", () => {
      expect(phaseA()).toContain("**Final-message self-check");
      expect(selfCheck()).toContain("rm -f " + PID_GLOB);
    });
  },
);

// ---------------------------------------------------------------------------
// DEFECT B — the non-zero-exit rationale must not contradict the same document
// ---------------------------------------------------------------------------

describeIfSmoke("Defect B — /smoke-test: the non-zero-exit rationale is true", () => {
  const selfCheck = () => boldClause(subsection(smoke!, GRANDCHILD), SELF_CHECK);

  test("slice sanity: the clause still carries the non-zero-exit mandate as one locatable sentence", () => {
    // Non-vacuity for the two assertions below — if the mandate sentence
    // stopped resolving, they would pass/fail for the wrong reason. This also
    // pins that the FIX rewrites the rationale rather than deleting the
    // mandate (which `mandatesNonZeroExitOnAbort` in the m112 file also owns).
    expect(nonZeroMandateSentence(selfCheck())).toBeDefined();
    expect(mandateParagraph(selfCheck()).length).toBeGreaterThan(0);
  });

  test("the rationale does not claim rc=0 is the only/sole signal that gets read", () => {
    expect(anySentenceClaimsExitCodeIsTheOnlySignal(selfCheck())).toBe(false);
  });

  test("the rationale is consistent with the chain-integrity check that reads the log set", () => {
    expect(mandateParagraph(selfCheck())).toMatch(CONSISTENT_RC_RATIONALE_RE);
  });

  // GREEN before implementation BY DESIGN — this is the sentence the current
  // rationale contradicts, two paragraphs down in the SAME clause. It must
  // survive, or the contradiction is "resolved" the wrong way.
  test("drift guard: the clause still states plainly that rc=0 is not proof the chain ran", () => {
    expect(selfCheck()).toMatch(/rc\s*=?\s*0\b[^.\n]{0,40}\bnot proof/i);
  });
});

describeIfLoop("Defect B — /conformance-loop: the non-zero-exit rationale is true", () => {
  const selfCheck = () => boldClause(phaseASlice(loop!), SELF_CHECK);

  test("slice sanity: the Phase A clause still carries the non-zero-exit mandate as one locatable sentence", () => {
    expect(nonZeroMandateSentence(selfCheck())).toBeDefined();
    expect(mandateParagraph(selfCheck()).length).toBeGreaterThan(0);
  });

  test("the Phase A rationale does not claim rc=0 is the only/sole signal that gets read", () => {
    expect(anySentenceClaimsExitCodeIsTheOnlySignal(selfCheck())).toBe(false);
  });

  test("the Phase A rationale is consistent with the leg-completeness check that reads the log set", () => {
    expect(mandateParagraph(selfCheck())).toMatch(CONSISTENT_RC_RATIONALE_RE);
  });

  test("drift guard: the Phase A clause still states plainly that rc=0 is not proof the legs ran their chains", () => {
    expect(selfCheck()).toMatch(/rc\s*=?\s*0\b[^.\n]{0,40}\bnot proof/i);
  });

  // The document this rationale contradicts. GREEN today; pinned so a future
  // edit cannot "resolve" the contradiction by weakening the check instead.
  test("drift guard: the leg-completeness check still says RC 0 alone is not proof and verifies the log set", () => {
    const check = boldClause(phaseASlice(loop!), "**Leg-completeness check");
    expect(check.length).toBeGreaterThan(0);
    expect(check).toMatch(/RC 0 alone is not proof/i);
    expect(check).toMatch(/log set/i);
  });
});
