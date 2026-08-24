// Meta-tests for STE-505 (M131) — a declared-runnable project must actually
// be driven.
//
// Shipped surfaces asserted here (the behavioural half — `resolveVerifyMode`'s
// full run_cmd × verify_mode matrix — lives in
// `adapters/_shared/src/verification_config.test.ts`, next to the module it
// pins):
//
//   - skills/implement/SKILL.md Phase 4b" — the drive is MANDATORY (not
//     offered) when `run_cmd` is declared and not `none`; the effective
//     verify_mode default is `blocking` on that same key; a failing drive
//     closes the step-15 commit gate; the non-interactive safe-decline default
//     does NOT apply on the declared path — the run FAILS rather than stalls
//     and rather than emitting the none-declared token; `MUST emit` directives
//     for the two new capability tokens.
//   - skills/spec-write/SKILL.md § 7 static capability map — both new tokens
//     with a plain-language rendering, on the SAME row as the existing verify
//     tokens (the map is one row per group; a new row would breach the file's
//     one-line cap).
//   - docs/verification-skills.md — the `verify_mode` semantics section states
//     the run_cmd-keyed rule and no longer claims `advisory` is
//     unconditionally "the default".
//   - specs/frs/STE-505.md — the AC.7 supersession argument, in writing; its
//     stale quotation of a since-rewritten guide sentence; and the unrecorded
//     `verify_mode: manual` + declared `run_cmd` exception to AC.1.
//   - docs/layout-reference.md + templates/CLAUDE.md.template — SURFACE PARITY:
//     both still taught the retired unconditional `advisory` default, and the
//     template is what `/setup` copies into every consuming project.
//   - a SWEEP over skills/**/*.md + docs/**/*.md + templates/** that fails if
//     ANY shipped surface states the retired unconditional default without a
//     `run_cmd` qualifier — the pin that makes the next missed surface
//     impossible.
//
// Assertion shape: every claim is pinned as a CONJUNCTION ON ONE LINE. Skill
// and doc paragraphs are single lines here, so a line-scoped conjunction proves
// the clauses were written about each other rather than merely co-occurring
// somewhere in the file — the failure mode a proximity window has. Every
// mandatory-path pin requires the literal `run_cmd`, which appears ZERO times
// in skills/implement/SKILL.md today, so none of them can pass vacuously
// against shipped prose. Each retired claim is additionally pinned as GONE.
//
// IMPORTANT: no assertion here requires an `STE-\d+` / `AC-STE-\d+` token in
// skills/** prose — that namespace ceiling has zero headroom.

import { Glob } from "bun";
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const pluginRoot = join(import.meta.dir, "..");
const repoRoot = join(pluginRoot, "..", "..");

const implementBody = readFileSync(
  join(pluginRoot, "skills", "implement", "SKILL.md"),
  "utf8",
);
const specWriteBody = readFileSync(
  join(pluginRoot, "skills", "spec-write", "SKILL.md"),
  "utf8",
);
const verifyDocBody = readFileSync(
  join(pluginRoot, "docs", "verification-skills.md"),
  "utf8",
);
// STE-505's body, wherever archival has left it. The active path alone would
// go red at the archive commit — the one transition no gate run precedes — so
// both homes are tried, the same fallback idiom the sibling M131 suites use.
const frBody = ((): string => {
  const candidates = [
    join(repoRoot, "specs", "frs", "STE-505.md"),
    join(repoRoot, "specs", "frs", "archive", "STE-505.md"),
  ];
  const path = candidates.find((p) => existsSync(p));
  if (path === undefined) {
    throw new Error(
      `STE-505.md is at neither specs/frs/ nor specs/frs/archive/: ${candidates.join(", ")}`,
    );
  }
  return readFileSync(path, "utf8");
})();
const layoutRefBody = readFileSync(
  join(pluginRoot, "docs", "layout-reference.md"),
  "utf8",
);
const templateBody = readFileSync(
  join(pluginRoot, "templates", "CLAUDE.md.template"),
  "utf8",
);

// "Phase 4b″" — U+2033 DOUBLE PRIME, same anchor
// tests/m93-ste-347-verification-convention.test.ts uses.
const PHASE_4B_DOUBLE_PRIME = "Phase 4b″";
const STEP_14_REPORT = "14. **Report**";

/** The five mutually-exclusive step-14 outcome tokens shipped by STE-347. */
const EXISTING_OUTCOME_TOKENS = [
  "verify_skill_passed",
  "verify_skill_failed_advisory",
  "verify_skill_failed_blocking",
  "verify_skill_manual_reminder",
  "verify_skill_none_declared",
] as const;

/** The non-outcome verify tokens shipped alongside them. */
const EXISTING_EVENT_TOKENS = [
  "verify_skill_adopted",
  "verify_skill_scaffolded",
  "verify_skill_scaffold_declined",
] as const;

/**
 * The two tokens this FR adds (AC-STE-505.6).
 *
 * `verify_drive_mandatory` — `run_cmd` is declared and not `none`, so Phase
 * 4b" RAN the drive rather than offering it.
 * `verify_drive_unavailable` — declared-runnable, but the drive could not be
 * run. A FAILURE token, and the one AC.4 requires INSTEAD of
 * `verify_skill_none_declared`.
 */
const DRIVE_MANDATORY = "verify_drive_mandatory";
const DRIVE_UNAVAILABLE = "verify_drive_unavailable";
const NEW_TOKENS = [DRIVE_MANDATORY, DRIVE_UNAVAILABLE] as const;

/** implement SKILL.md from the Phase 4b" heading to the step-14 report. */
function phase4bSection(): string {
  const start = implementBody.indexOf(PHASE_4B_DOUBLE_PRIME);
  expect(start).toBeGreaterThan(-1);
  const end = implementBody.indexOf(STEP_14_REPORT);
  expect(end).toBeGreaterThan(start);
  return implementBody.slice(start, end);
}

/** implement SKILL.md from the Phase 4b" heading to end of file. */
function phase4bOnward(): string {
  const start = implementBody.indexOf(PHASE_4B_DOUBLE_PRIME);
  expect(start).toBeGreaterThan(-1);
  return implementBody.slice(start);
}

type Needle = string | RegExp;

function matches(line: string, needle: Needle): boolean {
  return typeof needle === "string" ? line.includes(needle) : needle.test(line);
}

/**
 * The lines of `body` that satisfy EVERY needle. A conjunction on one line —
 * never a window across neighbouring paragraphs.
 */
function linesWithAll(body: string, needles: readonly Needle[]): string[] {
  return body
    .split("\n")
    .filter((line) => needles.every((n) => matches(line, n)));
}

/** Assert at least one line of `body` carries every needle together. */
function expectLineWithAll(
  body: string,
  needles: readonly Needle[],
  what: string,
): void {
  const hits = linesWithAll(body, needles);
  if (hits.length === 0) {
    throw new Error(
      `no single line carries all of [${needles
        .map((n) => String(n))
        .join(", ")}] — ${what}`,
    );
  }
  expect(hits.length).toBeGreaterThan(0);
}

/**
 * Blank-line-delimited paragraphs of `body`. Coarser than `linesWithAll` and
 * used ONLY where the shipped prose genuinely wraps across lines (the guide's
 * mandatory-drive paragraph, the FR's argument paragraphs). A paragraph is
 * still a single authored thought, so a conjunction inside one proves the
 * clauses were written about each other — unlike a whole-file `.includes()`.
 */
function paragraphs(body: string): string[] {
  return body
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p !== "");
}

/** The paragraphs of `body` that satisfy EVERY needle. */
function paragraphsWithAll(
  body: string,
  needles: readonly Needle[],
): string[] {
  return paragraphs(body).filter((p) => needles.every((n) => matches(p, n)));
}

/** Assert at least one paragraph of `body` carries every needle together. */
function expectParagraphWithAll(
  body: string,
  needles: readonly Needle[],
  what: string,
): void {
  const hits = paragraphsWithAll(body, needles);
  if (hits.length === 0) {
    throw new Error(
      `no single paragraph carries all of [${needles
        .map((n) => String(n))
        .join(", ")}] — ${what}`,
    );
  }
  expect(hits.length).toBeGreaterThan(0);
}

/** The `### \`verify_mode\` semantics` section of the authoring guide. */
function verifyModeSemantics(): string {
  const marker = "### `verify_mode` semantics";
  const start = verifyDocBody.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  const next = verifyDocBody.indexOf("\n### ", start + 1);
  return next === -1
    ? verifyDocBody.slice(start)
    : verifyDocBody.slice(start, next);
}

// ---------------------------------------------------------------------------
// AC-STE-505.6 — the new tokens are distinct from every shipped verify token.
// ---------------------------------------------------------------------------

describe("AC-STE-505.6 — new capability tokens are distinct literals", () => {
  test("neither new token collides with the five existing outcome tokens", () => {
    const existing = new Set<string>(EXISTING_OUTCOME_TOKENS);
    const collisions = NEW_TOKENS.filter((t) => existing.has(t));
    expect(collisions).toEqual([]);
    expect(existing.size).toBe(5);
  });

  test("neither new token collides with the non-outcome verify tokens", () => {
    const existing = new Set<string>([
      ...EXISTING_OUTCOME_TOKENS,
      ...EXISTING_EVENT_TOKENS,
    ]);
    const collisions = NEW_TOKENS.filter((t) => existing.has(t));
    expect(collisions).toEqual([]);
  });

  test("the two new tokens are distinct from each other", () => {
    expect(new Set<string>(NEW_TOKENS).size).toBe(2);
  });

  test("adding both widens the verify token vocabulary from 8 to 10", () => {
    const all = new Set<string>([
      ...EXISTING_OUTCOME_TOKENS,
      ...EXISTING_EVENT_TOKENS,
      ...NEW_TOKENS,
    ]);
    expect(all.size).toBe(10);
  });

  for (const token of NEW_TOKENS) {
    test(`implement SKILL.md carries a backticked MUST-emit directive for ${token}`, () => {
      expect(implementBody).toMatch(new RegExp("MUST emit `" + token + "`"));
    });
  }

  test("neither new token is smuggled in as a substring of an existing one", () => {
    // A `verify_skill_none_declared_drive`-style token would satisfy a naive
    // `.includes()` pin while emitting a DIFFERENT literal at runtime.
    for (const token of NEW_TOKENS) {
      for (const existing of [
        ...EXISTING_OUTCOME_TOKENS,
        ...EXISTING_EVENT_TOKENS,
      ]) {
        expect(token.includes(existing)).toBe(false);
        expect(existing.includes(token)).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-505.1 — the drive is mandatory, not offered.
// ---------------------------------------------------------------------------

describe("AC-STE-505.1 — Phase 4b\" runs the drive when run_cmd is declared", () => {
  test("one line keys mandatory-not-offered on run_cmd", () => {
    expectLineWithAll(
      phase4bSection(),
      ["run_cmd", /mandator/i, /not offered|never offered|not an offer|no offer/i],
      "Phase 4b\" must state that a declared run_cmd makes the drive mandatory rather than offered",
    );
  });

  test("the mandatory line carves out the literal `none`", () => {
    expectLineWithAll(
      phase4bSection(),
      ["run_cmd", "none", /mandator/i],
      "the mandatory rule must name `none` as the value that does NOT trigger it",
    );
  });

  test("the ran-the-drive path emits the mandatory token", () => {
    expectLineWithAll(
      phase4bOnward(),
      ["run_cmd", DRIVE_MANDATORY],
      "the mandatory token must be stated on a line that names its run_cmd trigger",
    );
  });
});

// ---------------------------------------------------------------------------
// AC-STE-505.2 — the effective verify_mode default is run_cmd-keyed.
// ---------------------------------------------------------------------------

describe("AC-STE-505.2 — blocking default keyed on run_cmd (prose half)", () => {
  test("one line states the blocking default and its run_cmd trigger", () => {
    expectLineWithAll(
      phase4bOnward(),
      ["run_cmd", "blocking", /default/i],
      "Phase 4b\" must state that the effective default is blocking when run_cmd is declared",
    );
  });

  test("Phase 4b\" names the resolver that computes the effective mode", () => {
    expect(phase4bSection()).toMatch(/resolveVerifyMode|verification_config/);
  });

  test("the retired unconditional claim `verify_mode: advisory` (the default) is GONE", () => {
    // Shipped M93 bytes: "`verify_mode: advisory` (the default) reports a
    // failing check in the step-14 report but the step-15 approval still
    // proceeds". Under AC.2 that parenthetical is no longer true.
    expect(phase4bOnward()).not.toContain("`verify_mode: advisory` (the default)");
  });

  test("advisory is still described, now as the conditional case", () => {
    // Guards the retirement above from being satisfied by DELETING the
    // advisory prose outright — AC.5 keeps that path intact.
    expect(phase4bOnward()).toContain("verify_mode: advisory");
  });
});

describe("AC-STE-505.2 — docs/verification-skills.md verify_mode semantics", () => {
  test("the semantics section states the run_cmd-keyed default", () => {
    expectLineWithAll(
      verifyModeSemantics(),
      ["run_cmd", "blocking", /default/i],
      "the guide must state which projects now default to blocking",
    );
  });

  test("the semantics section names `none` as keeping advisory", () => {
    expectLineWithAll(
      verifyModeSemantics(),
      ["run_cmd", "none", /advisory/],
      "the guide must state that a `none` (or absent) run_cmd keeps advisory",
    );
  });

  test("the retired claim `**`advisory`** (the default)` is GONE", () => {
    expect(verifyModeSemantics()).not.toContain("**`advisory`** (the default)");
  });

  test("the key table's retired `Absent key ⇒ default advisory` claim is GONE", () => {
    expect(verifyDocBody).not.toContain("Absent key ⇒ default `advisory`.");
  });

  test("the guide still teaches the promote-when-stable workflow", () => {
    // The FR's supersession argument turns on this staying unchanged.
    expect(verifyDocBody).toContain("Start with `advisory`");
    expect(verifyDocBody).toMatch(/promote to `blocking`/);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-505.3 — a failing drive under the new default closes the step-15 gate.
// ---------------------------------------------------------------------------

describe("AC-STE-505.3 — failing drive blocks the step-15 commit approval", () => {
  test("one line ties a failing declared-runnable drive to the step-15 gate", () => {
    expectLineWithAll(
      phase4bOnward(),
      ["run_cmd", /step[- ]15/, /block|gates|not offered/i],
      "a pin on {blocking, step-15} alone matches shipped M93 prose — the run_cmd key is what makes this discriminating",
    );
  });

  test("the step-15 gate still honours an explicit override", () => {
    expect(phase4bOnward()).toMatch(/override/i);
  });

  test("an explicit advisory still lets step-15 proceed", () => {
    expectLineWithAll(
      phase4bOnward(),
      ["verify_mode: advisory", /still proceeds|does not block|never blocks/i],
      "an explicitly-set advisory must remain an escape hatch (AC.5 + the FR's supersession argument)",
    );
  });
});

// ---------------------------------------------------------------------------
// AC-STE-505.4 — the non-interactive decline-default does not apply.
// ---------------------------------------------------------------------------

describe("AC-STE-505.4 — headless run FAILS rather than declining itself", () => {
  test("one line states the safe decline-default does not apply when run_cmd is set", () => {
    expectLineWithAll(
      phase4bSection(),
      [
        "run_cmd",
        /non-interactive|non-TTY|autonomous/,
        /does not apply|no longer applies|never applies|not apply/i,
      ],
      "the shipped safe-decline default must be explicitly carved out on the declared-runnable path",
    );
  });

  test("one line states the headless declared-runnable run FAILS", () => {
    expectLineWithAll(
      phase4bSection(),
      ["run_cmd", /fail/i, /non-interactive|non-TTY|autonomous/],
      "AC.4 requires failure, not a silent decline",
    );
  });

  test("failing is distinguished from stalling — the shipped no-stall rule survives", () => {
    // The FR is explicit: "the headless run does not stall, it fails".
    expectLineWithAll(
      phase4bSection(),
      [/stall/i, /fail/i],
      "Phase 4b\" must say the run fails rather than stalls, so the M93 no-stall rule is visibly preserved",
    );
  });

  test("verify_skill_none_declared is explicitly FORBIDDEN on the declared path", () => {
    expectLineWithAll(
      phase4bOnward(),
      [
        "run_cmd",
        "verify_skill_none_declared",
        /never|not|forbidden|instead/i,
      ],
      "AC.4 names the token that must NOT be emitted when run_cmd is declared",
    );
  });

  test("the unavailable token is the stated replacement", () => {
    expectLineWithAll(
      phase4bOnward(),
      ["run_cmd", DRIVE_UNAVAILABLE],
      "the failure token must be stated on a line naming its run_cmd trigger",
    );
  });
});

// ---------------------------------------------------------------------------
// AC-STE-505.5 — run_cmd: none / absent keep every existing path.
// ---------------------------------------------------------------------------

describe("AC-STE-505.5 — the none / absent paths are preserved, measured", () => {
  for (const token of EXISTING_OUTCOME_TOKENS) {
    test(`the shipped MUST-emit directive for ${token} survives`, () => {
      expect(implementBody).toMatch(new RegExp("MUST emit `" + token + "`"));
    });
  }

  for (const token of EXISTING_EVENT_TOKENS) {
    test(`the shipped MUST-emit directive for ${token} survives`, () => {
      expect(implementBody).toMatch(new RegExp("MUST emit `" + token + "`"));
    });
  }

  test("the shipped no-verification-configured note survives verbatim", () => {
    expect(phase4bSection()).toContain("no verification configured");
  });

  test("the shipped safe-decline default survives for the undeclared path", () => {
    const section = phase4bSection();
    expect(section).toMatch(/safe decline-default|default to decline/);
    expect(section).toMatch(/never block/i);
  });

  test("the shipped manual-mode rule survives", () => {
    expect(phase4bOnward()).toContain("never blocks");
  });

  test("every mandatory-drive claim is gated on run_cmd — none is unconditional", () => {
    // Each new-token mention must sit on a line that also names run_cmd. A
    // mandatory rule stated without its key would reach the `none` and absent
    // projects AC.5 protects.
    const onward = phase4bOnward();
    for (const token of NEW_TOKENS) {
      const mentions = linesWithAll(onward, [token]);
      expect(mentions.length).toBeGreaterThan(0);
      const ungated = mentions.filter((l) => !l.includes("run_cmd"));
      expect(ungated).toEqual([]);
    }
  });

  test("the guide's four-key table still documents run_cmd: none as an answer", () => {
    expect(verifyDocBody).toContain("`none` is an answer");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-505.6 — spec-write § 7 static capability map.
// ---------------------------------------------------------------------------

describe("AC-STE-505.6 — spec-write § 7 static capability map carries both tokens", () => {
  const mapIdx = specWriteBody.indexOf("Static plain-language map");

  test("the static map marker exists", () => {
    expect(mapIdx).toBeGreaterThan(-1);
  });

  for (const token of NEW_TOKENS) {
    test(`static map carries the \`${token}\` capability key`, () => {
      const tokenIdx = specWriteBody.indexOf(token);
      expect(tokenIdx).toBeGreaterThan(mapIdx);
    });

    test(`static map gives ${token} a backticked plain-language rendering`, () => {
      expect(specWriteBody).toMatch(
        new RegExp(token + ":\\s*`[^`]+`"),
      );
    });
  }

  test("both new tokens share the existing verify row (zero new lines)", () => {
    // § 7's map is one table row per group and the file sits one line under
    // its cap, so the tokens must extend the shipped verify row rather than
    // add one. Asserted, not assumed.
    const rows = linesWithAll(specWriteBody, [
      "verify_skill_none_declared",
      DRIVE_MANDATORY,
      DRIVE_UNAVAILABLE,
    ]);
    expect(rows.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-505.7 — the supersession argument, in writing.
// ---------------------------------------------------------------------------

describe("AC-STE-505.7 — FR records the supersession argument", () => {
  test("the FR carries a real Supersession argument section", () => {
    expect(frBody).toContain("### Supersession argument (AC.7)");
  });

  /** The FR body from the supersession heading to the next `## ` heading. */
  function supersession(): string {
    const start = frBody.indexOf("### Supersession argument (AC.7)");
    expect(start).toBeGreaterThan(-1);
    const next = frBody.indexOf("\n## ", start + 1);
    return next === -1 ? frBody.slice(start) : frBody.slice(start, next);
  }

  test("it NAMES the shipped decision it supersedes, by ticket and milestone", () => {
    const body = supersession();
    expect(body).toContain("STE-347");
    expect(body).toContain("M93");
    expect(body).toMatch(/chose advisory deliberately/);
  });

  test("it quotes the guide's shipped rationale sentence verbatim", () => {
    expect(supersession()).toContain(
      "This is the safe default: verification informs, it does not gate.",
    );
  });

  test("it states WHY the precondition changed, naming the new signal", () => {
    const body = supersession();
    expect(body).toMatch(/precondition has changed/);
    expect(body).toContain("STE-503");
    expect(body).toContain("run_cmd");
  });

  test("it states the reversal does not reach the projects the old default protected", () => {
    const body = supersession();
    expect(body).toMatch(/still declares `none` or declares nothing/);
    expect(body).toMatch(/keeps advisory/);
  });

  test("it states an explicit advisory remains settable", () => {
    expect(supersession()).toContain(
      "`verify_mode: advisory` also remains explicitly settable",
    );
  });

  test("it does not claim the earlier decision was a mistake", () => {
    // The argument's whole load-bearing move: precondition change, not error.
    expect(supersession()).toMatch(
      /not being overturned as a mistake|its precondition has changed/,
    );
  });
});

// ===========================================================================
// SURFACE PARITY (AC-STE-505.2 / AC-STE-505.4, shipped-prose half).
//
// The rule is one rule. Every shipped surface that teaches the `## Verification`
// block must teach the SAME rule, or the toolkit ships two contradictory
// contracts and `/setup` copies one of them into every new project. The pins
// below name each lagging surface; the sweeping pin at the bottom is the one
// that makes the NEXT missed surface impossible.
// ===========================================================================

/**
 * `body` split into LOGICAL UNITS: a bullet, a table row, a heading or a
 * paragraph, with wrapped continuation lines folded back in.
 *
 * A raw line-scoped conjunction is wrong for hard-wrapped surfaces — the
 * template wraps `Absent key ⇒ default` and `` `advisory` `` onto two lines, so
 * a line pin cannot see the claim at all. A blank-line paragraph is wrong the
 * other way — the layout-reference bullet list has no blank lines between
 * bullets, so a paragraph pin would let the `run_cmd` bullet vouch for the
 * `verify_mode` bullet next to it. A logical unit is exactly the authored
 * thought: one bullet, unwrapped.
 */
function logicalUnits(body: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  let cur: { line: number; text: string } | null = null;
  // A line that STARTS a new unit: bullet, ordered item, heading, table row,
  // block quote, or fence. Anything else continues the unit above it.
  const UNIT_START = /^(\s*(?:[-*+]|\d+\.)\s|#{1,6}\s|\||>|\s*```)/;
  body.split("\n").forEach((raw, i) => {
    if (raw.trim() === "") {
      cur = null;
      return;
    }
    if (cur === null || UNIT_START.test(raw)) {
      cur = { line: i + 1, text: raw.trim() };
      out.push(cur);
    } else {
      cur.text += ` ${raw.trim()}`;
    }
  });
  return out;
}

/** The logical units of `body` that satisfy EVERY needle. */
function unitsWithAll(body: string, needles: readonly Needle[]): string[] {
  return logicalUnits(body)
    .filter((u) => needles.every((n) => matches(u.text, n)))
    .map((u) => u.text);
}

/** Assert at least one logical unit of `body` carries every needle together. */
function expectUnitWithAll(
  body: string,
  needles: readonly Needle[],
  what: string,
): void {
  const hits = unitsWithAll(body, needles);
  if (hits.length === 0) {
    throw new Error(
      `no single logical unit carries all of [${needles
        .map((n) => String(n))
        .join(", ")}] — ${what}`,
    );
  }
  expect(hits.length).toBeGreaterThan(0);
}

/** The `## Verification` section of a surface, heading to next `## `. */
function verificationSection(body: string, what: string): string {
  const start = body.indexOf("## Verification");
  if (start < 0) throw new Error(`${what} has no ## Verification section`);
  const next = body.indexOf("\n## ", start + 1);
  return next === -1 ? body.slice(start) : body.slice(start, next);
}

describe("surface parity — docs/layout-reference.md ## Verification", () => {
  const section = () =>
    verificationSection(layoutRefBody, "docs/layout-reference.md");

  test("the verify_mode entry states the run_cmd-keyed default", () => {
    expectUnitWithAll(
      section(),
      ["verify_mode", "run_cmd", "blocking", /default/i],
      "layout-reference's verify_mode bullet must key the default on run_cmd, as skills/implement/SKILL.md and docs/verification-skills.md already do",
    );
  });

  test("it still states advisory as the run_cmd: none / absent case", () => {
    // Guards the fix from being made by deleting the advisory half outright —
    // AC.5 keeps that path, and the reader still has to be told about it.
    expectUnitWithAll(
      section(),
      ["verify_mode", "run_cmd", /advisory/],
      "the corrected entry must still tell a non-runnable project what it gets",
    );
  });

  test("the retired unconditional claim is GONE", () => {
    expect(section()).not.toContain(
      "defaulting to `advisory` when the section or the key is absent",
    );
  });

  test("no unit of the section states an unqualified advisory default", () => {
    expect(
      unitsWithAll(section(), [
        /advisory/,
        /(?:defaults?|defaulting)\s*(?:to\s+|is\s+)?`?advisory/i,
      ]).filter((u) => !u.includes("run_cmd")),
    ).toEqual([]);
  });

  test("all three mode names survive the rewrite", () => {
    const s = section();
    for (const mode of ["advisory", "blocking", "manual"]) {
      expect(s).toContain(mode);
    }
  });
});

describe("surface parity — templates/CLAUDE.md.template ## Verification", () => {
  // This is the file /setup copies into EVERY consuming project, so a retired
  // rule here does not merely mis-document the toolkit — it ships as authoring
  // guidance to every new project.
  const section = () =>
    verificationSection(templateBody, "templates/CLAUDE.md.template");

  test("the verify_mode key comment states the run_cmd-keyed default", () => {
    expectUnitWithAll(
      section(),
      ["verify_mode", "run_cmd", "blocking"],
      "the template's verify_mode comment must key the default on run_cmd",
    );
  });

  test("it still states advisory for the none / absent case", () => {
    expectUnitWithAll(
      section(),
      ["verify_mode", "run_cmd", /advisory/],
      "the corrected comment must still tell a non-runnable project what it gets",
    );
  });

  test("the retired `Absent key ⇒ default advisory` claim is GONE", () => {
    const s = section().replace(/\s+/g, " ");
    expect(s).not.toMatch(/Absent key ⇒ default `?advisory/i);
  });

  test("no unit of the section states an unqualified advisory default", () => {
    expect(
      unitsWithAll(section(), [
        /advisory/,
        /absent[^.]{0,120}(?:⇒|=>|is)[^.]{0,120}`?advisory|(?:defaults?|defaulting)\s*(?:to\s+|is\s+)?`?advisory/i,
      ]).filter((u) => !u.includes("run_cmd")),
    ).toEqual([]);
  });

  test("the template carries no tracker or milestone literal (house rule)", () => {
    // The parity fix must not smuggle one in while rewriting this block.
    expect(templateBody).not.toMatch(/STE-\d+/);
    expect(templateBody).not.toMatch(/\bM\d+\b/);
  });
});

// ---------------------------------------------------------------------------
// Guide-vs-skill parity for the mandatory-drive rule itself.
// ---------------------------------------------------------------------------

/** The authoring guide's mandatory-drive paragraph (it wraps, so paragraph). */
function mandatoryDriveParagraph(): string {
  const hits = paragraphsWithAll(verifyDocBody, [
    "run_cmd",
    /the drive is mandatory/i,
  ]);
  if (hits.length === 0) {
    throw new Error(
      "docs/verification-skills.md has no mandatory-drive paragraph keyed on run_cmd",
    );
  }
  return hits.join("\n");
}

describe("surface parity — the guide's mandatory-drive paragraph", () => {
  test("skills/implement/SKILL.md states the manual carve-out (parity baseline)", () => {
    // Proves the clause this leg demands of the guide actually exists on the
    // surface the guide is supposed to match — the pin below is not inventing
    // a rule, it is closing a gap.
    expectLineWithAll(
      phase4bSection(),
      ["run_cmd", "manual", /mandator/i],
      "the shipped skill states that a written manual mode survives the mandatory drive",
    );
  });

  test("the guide carries the manual carve-out too", () => {
    expectParagraphWithAll(
      mandatoryDriveParagraph(),
      ["manual", /written|explicit|declared/i],
      "the guide states the mandatory rule with NO verify_mode: manual carve-out, while the skill states it WITH one — a reader following the guide gets a different contract",
    );
  });

  test("the guide states that a written verify_mode still wins", () => {
    expectParagraphWithAll(
      mandatoryDriveParagraph(),
      ["verify_mode", /wins|precedence|beats|overrides|still/i],
      "the carve-out is only meaningful if the guide says an explicitly written mode outranks the run_cmd-keyed default",
    );
  });

  test("the guide states the token SUBSTITUTION, not just the failure", () => {
    expectParagraphWithAll(
      mandatoryDriveParagraph(),
      [
        DRIVE_UNAVAILABLE,
        "verify_skill_none_declared",
        /in place of|instead of|rather than|substitut/i,
      ],
      "the substitution rule currently lives only in skills/implement/SKILL.md and the spec-write § 7 map — the guide says the run fails but never says which token it emits",
    );
  });

  test("the guide's headless-failure sentence survives the rewrite", () => {
    expectParagraphWithAll(
      mandatoryDriveParagraph(),
      [/headless|non-interactive|non-TTY|autonomous/i, /fail/i],
      "AC.4's headless-fails rule must not be lost while adding the substitution clause",
    );
  });
});

// ===========================================================================
// THE SWEEPING PIN.
//
// Every parity fix above is a whack-a-mole on a surface someone thought of.
// This one walks EVERY shipped prose surface that documents the
// `## Verification` block and fails if ANY of them still states the retired
// unconditional `verify_mode` default. It is the assertion that makes the next
// missed surface impossible.
//
// Measured against the bytes at the time it was written, it named exactly two
// surfaces — docs/layout-reference.md and templates/CLAUDE.md.template — so it
// is demonstrably not vacuous. The self-tests below additionally prove the
// detector FIRES on the retired shape and stays QUIET on the corrected one.
// ===========================================================================

/**
 * The retired claim's shapes: an unconditional `verify_mode` default of
 * `advisory`, in any of the phrasings the shipped surfaces have used.
 */
const RETIRED_DEFAULT_SHAPES: readonly RegExp[] = [
  // "Absent key ⇒ default `advisory`" / "absent ... is advisory"
  /absent[^.]{0,120}(?:⇒|=>|means|is)[^.]{0,120}`?advisory/is,
  // "`advisory` (the default)"
  /`?advisory`?[^.`]{0,30}\((?:the )?default\)/i,
  // "defaulting to `advisory`" / "defaults to advisory" / "default `advisory`"
  /(?:defaults?|defaulting)\s*(?:to\s+|is\s+)?`?advisory/i,
  // "`advisory` is the default"
  /`?advisory`?[^.]{0,60}\bis (?:the )?default\b/i,
];

/**
 * True when `text` states the retired unconditional default: it claims an
 * `advisory` default in one of the shapes above WITHOUT naming `run_cmd` — the
 * qualifier that makes the claim true. A unit that says "advisory when
 * `run_cmd` is `none` or absent" is the CORRECTED rule and is not a violation.
 */
function statesRetiredDefault(text: string): boolean {
  if (!/advisory/i.test(text)) return false;
  if (text.includes("run_cmd")) return false;
  return RETIRED_DEFAULT_SHAPES.some((r) => r.test(text));
}

/** Every shipped prose surface in scope for the sweep. */
function sweptSurfaces(): { rel: string; body: string }[] {
  const out: { rel: string; body: string }[] = [];
  const seen = new Set<string>();
  for (const pattern of ["skills/**/*.md", "docs/**/*.md", "templates/**"]) {
    for (const rel of new Glob(pattern).scanSync(pluginRoot)) {
      if (seen.has(rel)) continue;
      seen.add(rel);
      let body: string;
      try {
        body = readFileSync(join(pluginRoot, rel), "utf8");
      } catch {
        continue;
      }
      // Only surfaces that actually document the key can mis-document it.
      if (!body.includes("verify_mode")) continue;
      out.push({ rel, body });
    }
  }
  return out;
}

/** `file:line` of every unit on every surface that states the retired rule. */
function retiredDefaultViolations(): string[] {
  const out: string[] = [];
  for (const { rel, body } of sweptSurfaces()) {
    for (const unit of logicalUnits(body)) {
      if (statesRetiredDefault(unit.text)) {
        out.push(`${rel}:${unit.line} — ${unit.text.slice(0, 120)}`);
      }
    }
  }
  return out;
}

describe("sweep — no shipped surface teaches the retired verify_mode default", () => {
  test("the sweep actually reaches the surfaces it claims to", () => {
    // A sweep over an empty file set passes vacuously and forever. Pin that
    // it sees the three surfaces this milestone has already corrected plus the
    // template `/setup` ships.
    const rels = sweptSurfaces().map((s) => s.rel);
    expect(rels.length).toBeGreaterThan(3);
    for (const required of [
      "skills/implement/SKILL.md",
      "docs/verification-skills.md",
      "docs/layout-reference.md",
      "templates/CLAUDE.md.template",
    ]) {
      expect(rels).toContain(required);
    }
  });

  test("the detector FIRES on each retired phrasing (not vacuous)", () => {
    for (const retired of [
      "- `verify_mode` — one of `advisory | blocking | manual`, defaulting to `advisory` when the section or the key is absent.",
      "  - verify_mode:  advisory | blocking | manual. Absent key ⇒ default `advisory` (report the outcome, never block the commit).",
      "`verify_mode: advisory` (the default) reports a failing check.",
      "| `verify_mode` | One of `advisory` \\| `blocking` \\| `manual`. Absent key ⇒ default `advisory`. |",
      "For `verify_mode`, `advisory` is the default when the key is absent.",
    ]) {
      expect(statesRetiredDefault(retired)).toBe(true);
    }
  });

  test("the detector stays QUIET on the corrected phrasings (not overbroad)", () => {
    for (const corrected of [
      "| `verify_mode` | Absent key ⇒ the default is computed from `run_cmd`: `blocking` when `run_cmd` declares a real command, `advisory` when `run_cmd` is `none`, empty, or absent. |",
      "- Absent `verify_mode` + a `run_cmd` that is `none`, empty, or absent ⇒ the default stays `advisory`, exactly as it always was.",
      "This is the default for a project whose `run_cmd` is `none` or absent, and it stays available to every project as an explicit setting.",
      "when the key is absent the default is `blocking` for a `run_cmd` declared as neither empty nor `none`, `advisory` otherwise.",
      "Absent key ⇒ default `ultracode`.",
    ]) {
      expect(statesRetiredDefault(corrected)).toBe(false);
    }
  });

  test("a wrapped claim is caught — the unit folder is load-bearing", () => {
    // The template wraps this claim across two lines; a raw line scan cannot
    // see it. Proves the folding is not decoration.
    const wrapped = [
      "  - verify_mode:  advisory | blocking | manual. Absent key ⇒ default",
      "                  `advisory` (report the outcome, never block the commit).",
      "  - run_cmd:      declares how this project is run.",
    ].join("\n");
    const units = logicalUnits(wrapped);
    expect(units.length).toBe(2);
    expect(statesRetiredDefault(units[0]!.text)).toBe(true);
    // ...and the neighbouring run_cmd bullet must NOT vouch for it.
    expect(units[0]!.text).not.toContain("run_cmd");
  });

  test("NO swept surface states the retired unconditional default", () => {
    const violations = retiredDefaultViolations();
    if (violations.length > 0) {
      throw new Error(
        `${violations.length} shipped surface(s) still teach the retired unconditional \`verify_mode\` default:\n  ${violations.join("\n  ")}`,
      );
    }
    expect(violations).toEqual([]);
  });
});

// ===========================================================================
// AC-STE-505.7 (continued) — the FR's own record must be honest and complete.
// The FR is a spec file, not shipped code, so its body is in scope for a pin.
// ===========================================================================

describe("AC-STE-505.7 — the FR's quoted rationale is marked as pre-change", () => {
  const QUOTE =
    "This is the safe default: verification informs, it does not gate.";

  test("the guide no longer carries that sentence (so an unmarked quote is stale)", () => {
    // The premise of this leg, asserted rather than assumed: if the guide still
    // said this, the FR would be quoting live text and nothing would be wrong.
    expect(verifyDocBody).not.toContain(QUOTE);
  });

  test("the FR still quotes it (the supersession argument needs it)", () => {
    expect(frBody).toContain(QUOTE);
  });

  test("the FR marks the quote as the PRE-CHANGE text, not as current", () => {
    expectParagraphWithAll(
      frBody,
      [
        QUOTE,
        /since been rewritten|has since been rewritten|since rewritten|pre-change|as it read before|no longer|then read|at the time/i,
      ],
      "the FR presents a sentence this milestone has since rewritten as if it were the guide's current text — the paragraph carrying the quote must say it is the pre-change wording",
    );
  });
});

describe("AC-STE-505.7 — the FR records the manual + run_cmd decision", () => {
  test("the shipped resolver really does let a written `manual` win", () => {
    // The premise: `resolveVerifyMode` returns a declared verify_mode before it
    // ever looks at run_cmd, so `manual` + a real run_cmd is a live path.
    const resolver = readFileSync(
      join(pluginRoot, "adapters", "_shared", "src", "verification_config.ts"),
      "utf8",
    );
    expect(resolver).toContain('declaredKeys.has("verify_mode")');
  });

  test("AC.1 is stated without an exception (the gap this leg records)", () => {
    const ac1 = linesWithAll(frBody, ["AC-STE-505.1"]);
    expect(ac1.length).toBe(1);
    expect(ac1[0]!).toMatch(/mandatory, not offered/);
  });

  test("the FR states the manual exception and names run_cmd with it", () => {
    expectParagraphWithAll(
      frBody,
      ["manual", "run_cmd", /exception|carve-out|carve out|does not apply|except/i],
      "the implementation ships an exception AC.1 does not mention — a declared `verify_mode: manual` keeps the no-auto-run path even when run_cmd declares a real command. The FR must record it.",
    );
  });

  test("the FR gives the REASONING, not just the fact", () => {
    expectParagraphWithAll(
      frBody,
      [
        "manual",
        /explicitly written|written `verify_mode`|explicit `verify_mode`|explicitly-set|written mode/i,
        /wins|beats|takes precedence|precedence|outranks/i,
      ],
      "the recorded decision must say WHY it is defensible: an explicitly written mode always beats the run_cmd-keyed default",
    );
  });
});

// ===========================================================================
// THIRD RED PASS — pre-PR spec-review finding (HIGH 2), AC-STE-505.4.
//
// The mandatory-drive paragraph carries the `manual` carve-out ("a project
// that has written `manual` keeps the no-auto-run reminder path below"), and
// so does the guide. The NON-TTY paragraph does not: it keys purely on
// `run_cmd` and then says, unconditionally, that the run **never** emits
// `verify_skill_none_declared` and **MUST emit** `verify_drive_unavailable`.
//
// Those two rules contradict each other on a real, reachable configuration:
// a headless run on a project with `run_cmd: bun run dev` AND a written
// `verify_mode: manual`. `resolveVerifyMode` returns `manual` there — an
// explicitly written mode always beats the run_cmd-keyed default, which is
// STE-505's own `### Recorded decision` — so nothing was ever supposed to be
// driven, and there is no drive to be "unavailable". Following the non-tty
// paragraph, that run reports a FAILURE carrying the wrong outcome token.
// Following the mandatory-drive paragraph, it reports the manual reminder.
// A skill that states both is a skill whose contract depends on which
// paragraph the reader reaches first.
//
// `verify_skill_manual_reminder` is the correct token: `manual` never
// auto-runs, so a non-tty run under it is not a run that could not drive —
// it is a run that was never going to.
//
// SCOPE. The needles below are asserted on the non-tty line ALONE, which is
// unique in Phase 4b″ (`run_cmd` + a non-interactive marker on one line). The
// mandatory-drive paragraph already carries `manual` and the token table
// already carries `verify_skill_manual_reminder`, so a whole-file or
// whole-section conjunction would pass on the contradictory bytes.
// ===========================================================================

/** A non-interactive / headless marker. */
const NON_TTY = /non-interactive|non-TTY|headless|autonomous/i;

/**
 * The lines of Phase 4b″ onward that state the NON-TTY rule for a declared
 * `run_cmd` — the paragraph that currently omits the `manual` carve-out.
 * Asserted non-empty so a rewrite that dissolves the rule cannot pass by
 * leaving nothing to check.
 */
function nonTtyRunCmdLines(): string[] {
  const hits = phase4bOnward()
    .split("\n")
    .filter((line) => line.includes("run_cmd") && NON_TTY.test(line));
  expect(hits.length).toBeGreaterThan(0);
  return hits;
}

describe("AC-STE-505.4 — the non-tty rule carries the same `manual` carve-out", () => {
  test("the non-tty rule names `manual` at all", () => {
    const hits = nonTtyRunCmdLines().filter((l) => l.includes("manual"));
    if (hits.length === 0) {
      throw new Error(
        "the non-tty declared-runnable rule keys purely on `run_cmd` and never mentions `verify_mode: manual` — " +
          "so it contradicts the mandatory-drive paragraph's carve-out on a headless run with `manual` + a real `run_cmd`",
      );
    }
    expect(hits.length).toBeGreaterThan(0);
  });

  test("the non-tty rule states `manual` as an EXCEPTION, not merely a mention", () => {
    const hits = nonTtyRunCmdLines().filter(
      (l) =>
        l.includes("manual") &&
        /except|unless|carve-out|carve out|does not apply|still wins|written|explicit/i.test(l),
    );
    expect(hits.length).toBeGreaterThan(0);
  });

  test("under `manual` the non-tty run emits `verify_skill_manual_reminder`", () => {
    const hits = nonTtyRunCmdLines().filter(
      (l) => l.includes("manual") && l.includes("verify_skill_manual_reminder"),
    );
    if (hits.length === 0) {
      throw new Error(
        "the non-tty rule must name `verify_skill_manual_reminder` as the token a headless `manual` + declared-`run_cmd` run emits — " +
          "`manual` never auto-runs, so that run is not one that could not drive",
      );
    }
    expect(hits.length).toBeGreaterThan(0);
  });

  test("`verify_drive_unavailable` is explicitly EXCLUDED under `manual`", () => {
    const hits = nonTtyRunCmdLines().filter(
      (l) =>
        l.includes(DRIVE_UNAVAILABLE) &&
        l.includes("manual") &&
        /not|never|instead of|rather than|no longer|except|unless/i.test(l),
    );
    if (hits.length === 0) {
      throw new Error(
        `the non-tty rule states \`${DRIVE_UNAVAILABLE}\` as an unconditional MUST — it must be scoped away from the written-\`manual\` path, ` +
          "or a headless run on a project that deliberately opted out of auto-running reads as a failure with the wrong token",
      );
    }
    expect(hits.length).toBeGreaterThan(0);
  });
});
