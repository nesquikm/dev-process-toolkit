// M117 STE-427 — correct the two falsified safety invariants in the smoke
// driver's own documentation.
//
// ===========================================================================
// WHY THIS FILE EXISTS
// ===========================================================================
//
// The 2026-07-27 conformance run measured two documented invariants FALSE.
// Neither caused damage; both are load-bearing for how `/smoke-test` reasons
// about its own safety, so an overstated claim is worse than the behavior it
// misdescribes — a reader who trusts it stops looking.
//
// DEFECT 1 — CONTAINMENT. Three sites in `.claude/skills/smoke-test/SKILL.md`
// (the Phase 0 operator contract fence, pre-flight #6's cwd-guard prose, and
// threat-model rail 2) plus `.claude/skills/conformance-loop/SKILL.md`'s
// delegated path-safety paragraph say the guard "bounds *where* the children
// operate" and that "the operator's other projects are unaffected". MEASURED:
// both the Phase 8 `/setup` and `/brainstorm` children wrote into
// `/Users/ns/english/mistakes/inbox/` — 3 files created inside the run window
// (14:29:57Z, 14:58:12Z, 15:07:23Z), confirmed by integer epoch-mtime
// comparison against the run-start stamp. Children inherit the operator's
// `CLAUDE_CONFIG_DIR` and the global instructions in it, so the guard bounds
// the SPAWN WORKING DIRECTORY — where each child *starts* — and nothing about
// the write set it issues from there. That narrower claim is true and is what
// the prose must say. It is also the reason the Phase 8 first-turn assertion
// has to be scoped to the project root at all (STE-399's `projectRoot` option,
// wired by STE-422): un-scoped, the operator's global-instruction write
// manufactures a run-killing false alarm against a child that behaved.
//
// DEFECT 2 — SETTINGS WRITES. Phase 1 step 6 asserts the child model layer
// "denies ALL `.claude/settings.json` writes — full-file Write AND append-only
// Edit alike (iter-2 confirmed **no child-side merge path** exists)", and
// derives from that the requirement that the parent pre-create the FULL final
// allow-list because "children can never extend it". MEASURED: the driver
// wrote 29 entries; the post-`/setup` committed file carries 50, and the
// child's own bootstrap commit body says "merged canonical bun allow-list into
// the pre-existing file (29 entries preserved, 21 added)". Recurrence of a
// 2026-07-20 observation. The sensitive-path classification is REAL for
// `.mcp.json` and for a direct child Write of `.claude/settings.json`; what is
// false is that it forecloses `/setup`'s MERGE path.
//
// ===========================================================================
// THE IMPLEMENTATION DECISION THESE TESTS ARE WRITTEN AGAINST
// ===========================================================================
//
// The child-side merge is OBSERVED-AND-DOCUMENTED behavior, not an enforcement
// gap to close. The parent pre-creation therefore survives, but on grounds that
// do not depend on the falsified premise:
//   (a) `.mcp.json` genuinely IS blocked from a child Write and must exist
//       before the first spawn;
//   (b) chicken-and-egg — a child cannot grant itself the permissions it needs
//       in order to start;
//   (c) the parent-written list is the reviewed artifact that `/smoke-test`
//       pre-flight #10 and `/gate-check` probe #62 both check.
//
// ===========================================================================
// TEST DESIGN — the traps this file is built to avoid
// ===========================================================================
//
// * PROJECT-LOCAL SURFACES. Both driver SKILLs live at repoRoot/.claude/skills/,
//   OUTSIDE `plugins/dev-process-toolkit`. Paths are built from
//   `join(import.meta.dir, "..", "..", "..")` and read through `readIfPresent`
//   + `describe.skip`, mirroring `smoke-driver-m96-verified-wipe-freshness`.
//   A pluginRoot-scoped sweep cannot see them and would pass vacuously in a
//   consumer checkout.
// * PARAGRAPH SCOPING. Every claim is asserted against the paragraph or the
//   section that carries it, never the whole file — a whole-file grep is
//   satisfiable from forty lines away, which this repo has been burned by.
//   Negative assertions assert their slice is non-empty FIRST: an empty slice
//   satisfies `.not.toMatch` for free.
// * NON-VACUOUS BY CONSTRUCTION. The FR's own Notes warn that the finding was
//   first checked by a query that silently failed to parse its argument and
//   returned a false clean. Every ban below is paired with a positive
//   requirement, so deleting the offending sentence without restating the
//   invariant fails just as loudly as leaving it.
// * HISTORY IS ALLOWED, ASSERTION IS NOT. The three falsified literals
//   (`no child-side merge path`, `never extend`, `denies ALL`) are not banned
//   outright — a paragraph may cite them as the claim that was falsified. What
//   is banned is carrying one WITHOUT a falsification marker, and carrying any
//   of them in the paragraph that still justifies the pre-creation.
//
// ===========================================================================
// BUDGETS AND BYTE PINS
// ===========================================================================
//
// * `.claude/skills/**` carries NO line cap and NO STE-N token ceiling (it is
//   outside `plugins/dev-process-toolkit`); ticket ids may be cited freely in
//   the edited prose and here.
// * NO new gate probe. A probe #74 would ripple to ~26 sites pinned on the
//   literal 73.
// * SURVIVING BYTE PINS, re-asserted at the bottom of this file so the edit
//   cannot drop them:
//     - `identical in both tracker paths` — required by
//       `tests/claude-spawn-allowlist.test.ts:317`.
//     - `sensitive-path classification` — required by
//       `tests/smoke-test-skill-fdr-cleanup.test.ts:86`.
//     - the `cat > .claude/settings.json <<'EOF'` scaffold heredoc and its
//       `Bash(claude:*)` entry — required by gate probe #62 and pre-flight #10.
// * `tests/smoke-driver-m96-verified-wipe-freshness.test.ts`'s `AC-STE-358.3`
//   block used to pin the OLD, falsified prose (`no child-side merge path`,
//   `never extend`). That conflict was real and was resolved during AC.3's
//   implementation: the block was RE-AIMED at the corrected contract — four
//   tests kept, now asserting the measured behavior — rather than deleted,
//   because deleting it would have silently dropped a shipped AC's fence. Its
//   file-header comment was corrected in the same change. This note is kept as
//   the record of that hand-off, not as an open item.

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

const smoke = readIfPresent(smokePath);
const loop = readIfPresent(loopPath);

const describeIfSmoke = smoke === null ? describe.skip : describe;
const describeIfLoop = loop === null ? describe.skip : describe;

// ---------------------------------------------------------------------------
// Slicing helpers (shape borrowed from smoke-driver-m96-verified-wipe-freshness)
// ---------------------------------------------------------------------------

function sectionSlice(
  body: string,
  startMarker: string,
  endMarker: string,
): string {
  const start = body.indexOf(startMarker);
  if (start === -1) return "";
  const end = body.indexOf(endMarker, start);
  return end === -1 ? body.slice(start) : body.slice(start, end);
}

/** Blank-line-delimited paragraphs. */
function paragraphs(body: string): string[] {
  return body.split(/\n\n+/);
}

/** Some paragraph satisfies EVERY pattern (proximity, not mere co-existence). */
function someParagraphMatches(body: string, patterns: RegExp[]): boolean {
  return paragraphs(body).some((p) => patterns.every((re) => re.test(p)));
}

/** Whitespace-collapsed, so a line-wrapped phrase still reads as one phrase. */
function norm(body: string): string {
  return body.replace(/\s+/g, " ");
}

/** Fenced-code-block bodies, in document order. */
function fencedBlocks(body: string): string[] {
  const out: string[] = [];
  let inBlock = false;
  let buf: string[] = [];
  for (const line of body.split("\n")) {
    if (/^\s*```/.test(line)) {
      if (inBlock) {
        out.push(buf.join("\n"));
        buf = [];
      }
      inBlock = !inBlock;
      continue;
    }
    if (inBlock) buf.push(line);
  }
  return out;
}

// § Pre-flight #6 — the path-safety / cwd-guard refusal.
function preflight6(body: string): string {
  return sectionSlice(
    body,
    "6. **Path-safety on the test-project location.**",
    "\n7. **",
  );
}

// § Phase 0 — pre-approval gate (prose + the operator contract fence).
function phase0(body: string): string {
  return sectionSlice(body, "### Phase 0 — Pre-approval gate", "### Phase 0.5");
}

// The operator-facing contract block printed before any side effect.
function operatorContractFence(body: string): string {
  return fencedBlocks(phase0(body)).find((b) => b.includes("Proceed?")) ?? "";
}

// § Phase 1 step 6 — the sensitive-file pre-creation step.
function phase1(body: string): string {
  return sectionSlice(
    body,
    "### Phase 1 — Setup",
    "### Phase 2 — Run the canonical chain",
  );
}

function step6(body: string): string {
  const p1 = phase1(body);
  const start = p1.indexOf("\n6. ");
  if (start === -1) return "";
  const end = p1.indexOf("6b.", start);
  return end === -1 ? p1.slice(start) : p1.slice(start, end);
}

// § Phase 8 — Socratic loop entry; where the projectRoot scoping is wired.
function phase8(body: string): string {
  return sectionSlice(body, "### Phase 8 — Socratic Loop Entry", "### Phase 9");
}

// § Threat model, and its rail 2 (the cwd guard).
function threatModel(body: string): string {
  return sectionSlice(body, "## Threat model", "**Coverage caveat**");
}

function cwdGuardRail(body: string): string {
  return sectionSlice(
    threatModel(body),
    "2. **Hard-coded paths (cwd guard).**",
    "3. **Throwaway directory.**",
  );
}

// § /conformance-loop Phase A — the guard it delegates to each child.
function delegatedGuard(body: string): string {
  return sectionSlice(
    body,
    "**Path-safety guard delegated to children.**",
    "**Aggregation.**",
  );
}

// ---------------------------------------------------------------------------
// Shared patterns
// ---------------------------------------------------------------------------

/** What the guard ACTUALLY bounds (AC-STE-427.1). */
const BOUNDS_SPAWN_CWD = /spawn cwd|spawn(?:ing)? working director(?:y|ies)|working director(?:y|ies)/i;

/** The falsified containment claim, in its wrapped-or-not form. */
const OTHER_PROJECTS_UNAFFECTED = /other projects\s+are\s+unaffected/i;

/** A write that lands outside the run's own test project. */
const OUTSIDE_PROJECT =
  /outside\s+(?:the\s+|this\s+|its\s+)?(?:test[- ]?)?project|out-of-project/i;

/** Inheritance of the operator's configuration directory (AC-STE-427.2). */
const CONFIG_DIR = /CLAUDE_CONFIG_DIR|configuration director(?:y|ies)|config director(?:y|ies)/i;
const GLOBAL_INSTRUCTIONS = /global[- ]instruction/i;

/** The measured date, from the FR's Verified block. */
const RUN_DATE = /2026-07-27/;

/** The three literals falsified on 2026-07-27. */
const FALSIFIED_LITERALS: readonly RegExp[] = [
  /no child-side merge path/i,
  /never extend/i,
  /denies ALL/i,
];

/** Prose that marks a claim as no longer held. */
const FALSIFICATION_MARKER =
  /falsified|no longer (?:holds|true)|withdrawn|retracted|refuted|contradicted|measured false|proved false|superseded|turned out false/i;

/**
 * Erase the falsified literals before testing for a merge mention.
 *
 * Without this, `/merg/i` is satisfied by the word inside "no child-side
 * MERGE path" — the exact sentence under repair. The first draft of the
 * classification test below passed for precisely that reason, which is the
 * vacuous-check failure mode the FR's Notes warn about, reproduced in
 * miniature. A paragraph must earn its merge mention independently.
 */
function deliteralize(paragraph: string): string {
  return FALSIFIED_LITERALS.reduce(
    (acc, re) => acc.replace(new RegExp(re.source, "gi"), " "),
    paragraph,
  );
}

/** {@link someParagraphMatches}, with the falsified literals erased first. */
function someParagraphMatchesNetOfFalsified(
  body: string,
  patterns: RegExp[],
): boolean {
  return paragraphs(body)
    .map(deliteralize)
    .some((p) => patterns.every((re) => re.test(p)));
}

// ===========================================================================
// AC-STE-427.1 — the containment claim names the spawn working directory and
// drops the unconditional "other projects are unaffected".
// ===========================================================================

describeIfSmoke("AC-STE-427.1 — containment claim states what the guard bounds", () => {
  test("the Phase 0 operator contract names the spawn working directory", () => {
    const fence = operatorContractFence(smoke!);
    expect(fence.length).toBeGreaterThan(0);
    expect(fence).toMatch(BOUNDS_SPAWN_CWD);
  });

  test("the Phase 0 operator contract drops the unconditional containment claim", () => {
    const fence = operatorContractFence(smoke!);
    expect(fence.length).toBeGreaterThan(0); // non-vacuity for the ban below
    expect(norm(fence)).not.toMatch(OTHER_PROJECTS_UNAFFECTED);
  });

  test("the operator is told writes outside the test project are possible", () => {
    // The positive half of the ban above: deleting the sentence is not enough,
    // the operator must be told the true shape before they type `y`.
    const fence = operatorContractFence(smoke!);
    expect(someParagraphMatches(fence, [OUTSIDE_PROJECT, /write/i])).toBe(true);
  });

  test("threat-model rail 2 restates the cwd guard as bounding the spawn cwd", () => {
    const rail = cwdGuardRail(smoke!);
    expect(rail.length).toBeGreaterThan(0);
    expect(
      someParagraphMatches(rail, [/cwd guard/i, /bound/i, BOUNDS_SPAWN_CWD]),
    ).toBe(true);
  });

  test("threat-model rail 2 drops the unconditional containment claim", () => {
    const rail = cwdGuardRail(smoke!);
    expect(rail.length).toBeGreaterThan(0);
    expect(norm(rail)).not.toMatch(OTHER_PROJECTS_UNAFFECTED);
  });

  test("pre-flight #6's cwd-guard prose names the spawn working directory", () => {
    const pf6 = preflight6(smoke!);
    expect(pf6.length).toBeGreaterThan(0);
    expect(someParagraphMatches(pf6, [/cwd guard/i, BOUNDS_SPAWN_CWD])).toBe(
      true,
    );
  });

  test("no site in the smoke driver still carries the falsified phrasing", () => {
    // Whole-file, deliberately: this claim must not survive ANYWHERE, and a
    // negative sweep cannot be satisfied from forty lines away.
    expect(smoke!.length).toBeGreaterThan(0);
    expect(norm(smoke!)).not.toMatch(OTHER_PROJECTS_UNAFFECTED);
  });
});

describeIfLoop("AC-STE-427.1 — /conformance-loop's delegated guard matches", () => {
  test("the delegated path-safety paragraph names the spawn working directory", () => {
    const guard = delegatedGuard(loop!);
    expect(guard.length).toBeGreaterThan(0);
    expect(someParagraphMatches(guard, [/cwd guard/i, BOUNDS_SPAWN_CWD])).toBe(
      true,
    );
  });

  test("the delegated paragraph makes no unconditional containment claim", () => {
    const guard = delegatedGuard(loop!);
    expect(guard.length).toBeGreaterThan(0);
    expect(norm(guard)).not.toMatch(OTHER_PROJECTS_UNAFFECTED);
  });
});

// ===========================================================================
// AC-STE-427.2 — the inheritance of the operator's config dir is documented,
// and named as the reason first-turn assertions are scoped to the project root.
// ===========================================================================

describeIfSmoke("AC-STE-427.2 — config-dir inheritance is documented", () => {
  test("the threat model records inheritance → out-of-project writes", () => {
    const threat = threatModel(smoke!);
    expect(threat.length).toBeGreaterThan(0);
    expect(
      someParagraphMatches(threat, [
        /inherit/i,
        CONFIG_DIR,
        GLOBAL_INSTRUCTIONS,
        OUTSIDE_PROJECT,
      ]),
    ).toBe(true);
  });

  test("the record is dated to the run that measured it", () => {
    // The FR's Notes: the first check of this finding silently returned a
    // false clean. The dated citation is what makes the claim auditable
    // instead of a second unfalsifiable assertion.
    expect(someParagraphMatches(smoke!, [RUN_DATE, /inherit/i])).toBe(true);
  });

  test("Phase 8 names inheritance as the reason for project-root scoping", () => {
    const p8 = phase8(smoke!);
    expect(p8.length).toBeGreaterThan(0);
    expect(
      someParagraphMatches(p8, [
        /project root|projectRoot/,
        /inherit/i,
        GLOBAL_INSTRUCTIONS,
      ]),
    ).toBe(true);
  });

  test("Phase 8 ties that reason to the first-turn assertion it scopes", () => {
    const p8 = phase8(smoke!);
    expect(
      someParagraphMatches(p8, [
        /first[- ]turn|assertFirstTurnShape|scaffold/i,
        /scope[ds]?\b|scoping/i,
        /project root|projectRoot/,
      ]),
    ).toBe(true);
  });
});

// ===========================================================================
// AC-STE-427.3 — the settings-write invariant matches measured behavior.
// ===========================================================================

describeIfSmoke("AC-STE-427.3 — settings-write invariant restated", () => {
  test("step 6 no longer asserts the falsified claims as current", () => {
    // Each literal may be CITED as the claim that fell, but a paragraph that
    // carries one without a falsification marker is still asserting it.
    const body = smoke!;
    expect(body.length).toBeGreaterThan(0);
    for (const para of paragraphs(body)) {
      for (const literal of FALSIFIED_LITERALS) {
        if (literal.test(para)) {
          expect(para).toMatch(FALSIFICATION_MARKER);
        }
      }
    }
  });

  test("step 6 records the measured child-side merge of settings.json", () => {
    const s6 = step6(smoke!);
    expect(s6.length).toBeGreaterThan(0);
    expect(
      someParagraphMatchesNetOfFalsified(s6, [
        /child/i,
        /merg/i,
        /settings\.json/,
        RUN_DATE,
      ]),
    ).toBe(true);
  });

  test("the measurement is quantified: 29 entries in, 50 out", () => {
    // Numbers, not adjectives — the FR's evidence is the child's own commit
    // body ("29 entries preserved, 21 added") against a 29-entry scaffold.
    expect(
      someParagraphMatchesNetOfFalsified(smoke!, [/\b29\b/, /\b50\b/, /merg/i]),
    ).toBe(true);
  });

  test("the sensitive-path classification survives, qualified by the merge", () => {
    // Constraint from tests/smoke-test-skill-fdr-cleanup.test.ts:86 — the
    // classification framing is REAL (.mcp.json, direct child Write) and must
    // survive. What must change is the over-reach: it never foreclosed
    // /setup's merge path, and step 6 is where that is claimed. The date is
    // required so the qualification is the MEASURED one, not a hedge.
    const s6 = step6(smoke!);
    expect(s6.length).toBeGreaterThan(0);
    expect(s6).toMatch(/sensitive-path classification/i);
    expect(
      someParagraphMatchesNetOfFalsified(s6, [
        /sensitive-path classification/i,
        /\.mcp\.json/,
        /merg/i,
        RUN_DATE,
      ]),
    ).toBe(true);
  });
});

// ===========================================================================
// AC-STE-427.4 — the parent-pre-creation rationale rests on surviving grounds.
// ===========================================================================

describeIfSmoke("AC-STE-427.4 — pre-creation re-justified on its actual merits", () => {
  test("ground (a): .mcp.json is blocked from the child and must precede the first spawn", () => {
    const s6 = step6(smoke!);
    expect(s6.length).toBeGreaterThan(0);
    expect(
      someParagraphMatches(s6, [
        /\.mcp\.json/,
        /block|denied|cannot write|sensitive-path/i,
        /before\s+(?:the\s+|any\s+)?(?:first\s+)?(?:child\s+)?spawn/i,
      ]),
    ).toBe(true);
  });

  test("ground (b): chicken-and-egg — a child cannot grant itself its own permissions", () => {
    const s6 = step6(smoke!);
    expect(
      someParagraphMatches(s6, [
        /chicken[- ]and[- ]egg|grant itself/i,
        /permission/i,
      ]),
    ).toBe(true);
  });

  test("ground (c): the parent-written list is the artifact #10 and #62 check", () => {
    const s6 = step6(smoke!);
    expect(
      someParagraphMatches(s6, [/pre-flight #10/i, /#62/, /review/i]),
    ).toBe(true);
  });

  test("the surviving rationale cites none of the falsified claims", () => {
    // The load-bearing pin of this AC. The paragraph that still requires the
    // parent to carry the complete list must stand on (a)/(b)/(c) alone —
    // a falsification note elsewhere does not license re-using the dead
    // premise as the justification here.
    const s6 = step6(smoke!);
    const justifying = paragraphs(s6).filter((p) =>
      /full final allow-list/i.test(p),
    );
    expect(justifying.length).toBeGreaterThan(0); // non-vacuity
    for (const para of justifying) {
      for (const literal of FALSIFIED_LITERALS) {
        expect(para).not.toMatch(literal);
      }
    }
  });

  test("the pre-creation step itself is still required", () => {
    // Guards the opposite over-correction: AC-STE-427.3 must not be read as
    // "the child can do it, drop the step".
    const s6 = step6(smoke!);
    expect(someParagraphMatches(s6, [/full final allow-list/i, /pre-creat/i])).toBe(
      true,
    );
  });
});

// ===========================================================================
// Byte pins that this FR's edits must not break.
// ===========================================================================

describeIfSmoke("byte pins — surviving contracts other suites depend on", () => {
  test("`identical in both tracker paths` survives (claude-spawn-allowlist.test.ts:317)", () => {
    expect(smoke!).toContain("identical in both tracker paths");
  });

  test("`sensitive-path classification` survives (smoke-test-skill-fdr-cleanup.test.ts:86)", () => {
    expect(smoke!).toMatch(/sensitive-path classification/i);
  });

  test("the settings scaffold heredoc survives (gate probe #62, pre-flight #10)", () => {
    const s6 = step6(smoke!);
    expect(s6).toContain("cat > .claude/settings.json <<'EOF'");
    expect(s6).toContain('"Bash(claude:*)"');
  });

  test("no probe #74 is introduced by this FR", () => {
    // Adding a gate probe ripples to ~26 sites pinned on the literal 73. This
    // FR is prose-only by construction.
    expect(smoke!).not.toMatch(/probe #74/i);
  });
});
