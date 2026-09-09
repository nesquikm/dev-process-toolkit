// STE-580 (M_840a06) — a second repo JOINS a milestone instead of minting a rival.
//
// THE MEASURED ASYMMETRY this FR closes in prose (both halves asserted below as
// live controls, so the subject cannot quietly move out from under the clause):
//
//   adapters/_shared/src/attach_project_milestone.ts:676-678
//     the BIND path — which only READS — REFUSES without the enumerator:
//     'attachProjectMilestone: milestoneBinding === "epic" requires
//      listEpics/setParent ops on the provider'
//   adapters/_shared/src/mint_milestone_epic.ts:88
//     the MINT path — which CREATES, on a board with no delete tool — does the
//     opposite: "`listEpics` is optional; without it a mint simply has no find
//     leg."
//
// So the read path refuses without the find leg while the create path silently
// degrades to an unconditional create. STE-580 closes that at the CALLER's
// obligation, in the allocation guard at `skills/spec-write/SKILL.md:177`.
//
// THE SITE. Line 177 is a SINGLE line, 9,675 characters at HEAD, whose tail
// reads "… no Epic is ever created off the Jira path." The change APPENDS, so
// it is line-neutral by construction: the file stays at exactly 358 split-lines
// and the clause under test is everything AFTER that tail sentence.
//
// EACH REQUIRED ELEMENT IS ASSERTED SEPARATELY. A roll-up that greens on three
// of four is the exact hole this repository has recorded as "milestone
// reproduces its own defect" — so the join, the by-key rule, the refusal, the
// residual-gap admission and the `repo_tag` mention each get their own test.
//
// Every prose assertion is scoped to the APPENDED CLAUSE, never to the whole
// 9,675-character line: `mintMilestoneEpic`, `milestoneIdFromEpicKey` and
// sixteen module paths already appear on that line, so a line-wide `toContain`
// would pass at HEAD and prove nothing.

import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ORDERED_UNREACHABLE_PIN,
  runModuleReachabilityProbe,
} from "../adapters/_shared/src/module_reachability";

const pluginRoot = join(import.meta.dir, "..");
const repoRoot = join(pluginRoot, "..", "..");

const SPEC_WRITE_SKILL = join(pluginRoot, "skills", "spec-write", "SKILL.md");
const SPEC_WRITE_REL = "skills/spec-write/SKILL.md";
const MINT_HELPER = join(pluginRoot, "adapters", "_shared", "src", "mint_milestone_epic.ts");
const ATTACH_HELPER_REL = "adapters/_shared/src/attach_project_milestone.ts";
const ATTACH_HELPER = join(pluginRoot, ATTACH_HELPER_REL);

const read = (p: string) => readFileSync(p, "utf-8");

/** Measured at HEAD: `wc -l` + 1 on the split. The append must not move it. */
const SPLIT_LINES_AT_HEAD = 358;
/** Measured at HEAD: `body.split("\n")[176].length`. The append only grows it. */
const LINE_177_LEN_AT_HEAD = 9675;
/** Measured at HEAD: sixteen `<dir>/<file>.ts` paths already on line 177. */
const MODULE_PATHS_ON_LINE_177_AT_HEAD = 16;
/** The HEAD tail of line 177. The clause is appended AFTER this sentence. */
const HEAD_TAIL = "no Epic is ever created off the Jira path.";

const MODULE_PATH_RE = /[A-Za-z0-9_.\-]+\/[A-Za-z0-9_.\-]+\.ts\b/g;

function splitLines(): string[] {
  return read(SPEC_WRITE_SKILL).split("\n");
}

function line177(): string {
  const line = splitLines()[176];
  expect(line, "line 177 must exist — the allocation guard lives there").toBeString();
  return line as string;
}

/**
 * The APPENDED clause: everything on line 177 after the HEAD tail sentence.
 *
 * At HEAD this is the empty string, which is why every clause assertion below
 * is RED before the edit and cannot be satisfied by text that already ships.
 */
function appendedClause(): string {
  const line = line177();
  const idx = line.indexOf(HEAD_TAIL);
  expect(
    idx,
    `line 177 must still end its HEAD text with "${HEAD_TAIL}" — the clause is an ` +
      "APPEND, so deleting or rewriting that tail is out of scope for STE-580",
  ).toBeGreaterThan(-1);
  const end = idx + HEAD_TAIL.length;
  expect(
    end,
    "the text BEFORE the appended clause must not shrink: at HEAD the tail sentence " +
      `ends at character ${LINE_177_LEN_AT_HEAD}`,
  ).toBeGreaterThanOrEqual(LINE_177_LEN_AT_HEAD);
  return line.slice(end);
}

/** The one sentence of the clause containing `token`, for scoped assertions. */
function sentenceWith(clause: string, token: string): string {
  const idx = clause.indexOf(token);
  expect(idx, `the appended clause must name ${token}`).toBeGreaterThan(-1);
  const start = clause.lastIndexOf(".", idx) + 1;
  const dot = clause.indexOf(".", idx + token.length);
  return clause.slice(start, dot === -1 ? clause.length : dot + 1);
}

/** A real `grep -c`, so the measurement is the one the AC names. */
function grepCount(token: string, relPath: string): number {
  const proc = Bun.spawnSync(["grep", "-c", token, relPath], { cwd: pluginRoot });
  const out = proc.stdout.toString().trim();
  // grep -c exits 1 with "0" on no match, 0 with a count on a match, >1 on error.
  expect(
    proc.exitCode,
    `grep -c ${token} ${relPath} errored: ${proc.stderr.toString()}`,
  ).toBeLessThanOrEqual(1);
  return Number.parseInt(out, 10);
}

function steTokenCount(body: string): number {
  return (body.match(/STE-\d+/g) ?? []).length;
}

// ===========================================================================
// AC-STE-580.1 — the join instruction, and the line-neutral append.
// ===========================================================================

describe("AC-STE-580.1 — exactly one repo mints, every other derives", () => {
  test("the appended clause exists at all — line 177 grew past its 9,675 HEAD characters", () => {
    expect(
      line177().length,
      "the clause is an APPEND to line 177; its length must be strictly greater than " +
        `its ${LINE_177_LEN_AT_HEAD} characters at HEAD`,
    ).toBeGreaterThan(LINE_177_LEN_AT_HEAD);
    expect(appendedClause().trim().length).toBeGreaterThan(0);
  });

  test("the file measures exactly 358 split-lines — appending is line-neutral", () => {
    expect(
      splitLines().length,
      "NFR-1's cap on this file is enforced by a pinned split-line count; an APPEND to " +
        "an existing line adds zero lines",
    ).toBe(SPLIT_LINES_AT_HEAD);
  });

  test("line 177 is still ONE line — its two neighbours are still blank", () => {
    const lines = splitLines();
    expect(lines[175], "line 176 is the blank separating the guard from what precedes it").toBe("");
    expect(
      lines[177],
      "line 178 is the blank after the guard; a wrapped clause would push prose here",
    ).toBe("");
    expect(line177()).not.toContain("\n");
  });

  test("the clause orders that EXACTLY ONE repo mints a milestone's container", () => {
    const clause = appendedClause();
    expect(
      clause,
      "a shared tracker project means the SECOND REPO JOINS — the clause must say that " +
        "exactly one repo mints the container",
    ).toMatch(/(exactly|only) one repo\b[^.]*\bmint/i);
  });

  test("the clause orders every OTHER repo to DERIVE from the key that already exists", () => {
    const clause = appendedClause();
    expect(clause, "the join is a derivation, not a creation").toMatch(/deriv/i);
    expect(
      clause,
      "the derivation reads the key off the Epic that ALREADY EXISTS",
    ).toMatch(/already exists|existing|that exists/i);
  });

  test("the clause names `milestoneIdFromEpicKey` as the derivation, on the read-back key", () => {
    const clause = appendedClause();
    expect(
      clause,
      "the joining repo derives its milestone id through `milestoneIdFromEpicKey` on the " +
        "Epic key read off the existing Epic",
    ).toContain("milestoneIdFromEpicKey");
  });

  test("the clause forbids a SECOND `mintMilestoneEpic` call", () => {
    const clause = appendedClause();
    const sentence = sentenceWith(clause, "mintMilestoneEpic");
    expect(
      sentence,
      "the joining repo must NEVER make a second `mintMilestoneEpic` call — the whole " +
        `defect is a rival container. Sentence read: ${JSON.stringify(sentence)}`,
    ).toMatch(/\b(never|not|no)\b/i);
    expect(sentence).toMatch(/second|another|its own|rival/i);
  });
});

// ===========================================================================
// AC-STE-580.2 — by key, never by name; and the residual gap, named.
// ===========================================================================

describe("AC-STE-580.2 — the join is BY KEY and NEVER BY NAME", () => {
  test("the clause says the join is by key", () => {
    expect(appendedClause(), "STE-521's precedent: an Epic-keyed milestone binds by key").toMatch(
      /by (the )?key/i,
    );
  });

  test("the clause says the join is NEVER by name", () => {
    const clause = appendedClause();
    expect(
      clause,
      "five of this project's milestones carry a renamed form while the most recent " +
        "carries the bare title the mint writes — names are unsafe to join on",
    ).toMatch(/(never|not|no)\b[^.]{0,80}\bby (the )?(name|summary|title)/i);
  });
});

describe("AC-STE-580.2 — the residual gap this FR does NOT close is named", () => {
  test("the clause admits the container is found by a HUMAN-TYPED TITLE", () => {
    expect(
      appendedClause(),
      "one clause must name what ordering the join does not fix: the find leg still " +
        "matches a human-typed title",
    ).toMatch(/human-typed/i);
  });

  test("the clause says ordering the join is not the same as making it ROBUST", () => {
    const clause = appendedClause();
    const sentence = sentenceWith(clause, "human-typed");
    expect(
      sentence,
      `the admission must land in the same clause as the gap. Sentence read: ${JSON.stringify(sentence)}`,
    ).toMatch(/robust/i);
  });
});

// ===========================================================================
// AC-STE-580.3 — the capped file's measurements, unmoved.
// ===========================================================================

/** Frozen historical value. DOWN-ONLY: this FR may not RAISE the pin. */
const PIN_FROZEN_AT = 129;

describe("AC-STE-580.3 — no module path, no new STE token, no raised pin", () => {
  test("the appended clause names NO module path — bare function names only", () => {
    const clause = appendedClause();
    expect(
      clause.match(MODULE_PATH_RE),
      "naming a `<dir>/<file>.ts` on an ORDERED line raises ORDERED_UNREACHABLE_PIN " +
        "129 -> 130, and gradePinLedger refuses a recorded raise. Backticked FUNCTION " +
        "names (`mintMilestoneEpic`, `milestoneIdFromEpicKey`, `listEpics`) are free.",
    ).toBeNull();
  });

  test("line 177's module-path count is unmoved at 16", () => {
    expect(
      (line177().match(MODULE_PATH_RE) ?? []).length,
      "the append must not add a seventeenth module path, and must not delete one either",
    ).toBe(MODULE_PATHS_ON_LINE_177_AT_HEAD);
  });

  test("the milestone-attachment paragraph is still at line 111", () => {
    const lines = splitLines();
    expect(
      lines[110],
      "line 177 sits BELOW the attachment paragraph, so an append cannot move it — " +
        "asserted anyway, because a reflow would",
    ).toContain("**Milestone attachment");
  });

  test("ORDERED_UNREACHABLE_PIN is not raised, and the AWAITED probe measures it", async () => {
    expect(ORDERED_UNREACHABLE_PIN).toBeLessThanOrEqual(PIN_FROZEN_AT);
    // AWAITED. runModuleReachabilityProbe is async: without `await` every field
    // below reads `undefined` and every assertion passes vacuously.
    const report = await runModuleReachabilityProbe(repoRoot);
    expect(typeof report.orderedUnreachable, "the probe must be AWAITED, not a promise").toBe(
      "number",
    );
    // The LIVE count must equal the SHIPPED pin — not a literal. Pinning the
    // literal is the anti-pattern module_reachability.ts:624 names outright: it
    // is true for exactly one commit and reds every later LOWERING, which is a
    // reachability IMPROVEMENT. That is the recorded M140 failure mode, and the
    // sibling suites (m139/m140/m141/m_8f8e25/m_a41431/m_a8e09a, and this
    // milestone own ste-579) all read the constant instead.
    expect(
      report.orderedUnreachable,
      `measured ${report.orderedUnreachable} against pin ${ORDERED_UNREACHABLE_PIN}`,
    ).toBe(ORDERED_UNREACHABLE_PIN);
    // DOWN-ONLY: the pin may fall below where this FR froze it (someone gave an
    // unreachable module a front door) but must never rise above it.
    expect(
      ORDERED_UNREACHABLE_PIN,
      "this FR must not RAISE the down-only pin; a lowering is legitimate and must pass",
    ).toBeLessThanOrEqual(PIN_FROZEN_AT);
    expect(report.violations.filter((v) => v.severity === "error")).toEqual([]);
    expect(report.ok).toBe(true);
  }, 120_000);

  test("spec-write/SKILL.md adds ZERO STE tokens — the file total is unmoved at 54", () => {
    const count = steTokenCount(read(SPEC_WRITE_SKILL));
    expect(count).toBeLessThanOrEqual(55);
    expect(
      count,
      "cite module and FUNCTION names, never ticket ids: the tree total is pinned with " +
        "`.toBe(245)` by FOUR suites, so one new token reds all four",
    ).toBe(54);
  });

  test("the skills/**/*.md STE-token total is unmoved at 245", () => {
    const skillsRoot = join(pluginRoot, "skills");
    let total = 0;
    let files = 0;
    for (const rel of new Glob("**/*.md").scanSync(skillsRoot)) {
      files += 1;
      total += steTokenCount(read(join(skillsRoot, rel)));
    }
    expect(files, "the walk is non-vacuous").toBeGreaterThan(20);
    expect(total).toBeLessThanOrEqual(246);
    expect(total).toBe(245);
  });
});

// ===========================================================================
// AC-STE-580.4 — the find leg is OPTIONAL, so a missing one is a REFUSAL.
// ===========================================================================

describe("AC-STE-580.4 — a provider without `listEpics` is a refusal, not a mint", () => {
  test("the clause states the mint helper's find leg is OPTIONAL", () => {
    const clause = appendedClause();
    expect(clause, "the caller must be told the find leg is optional").toMatch(/optional/i);
    expect(clause).toMatch(/find leg/i);
  });

  test("the clause names `listEpics` as the missing operation", () => {
    expect(
      appendedClause(),
      "the caller's obligation is stated against the very op the mint helper treats as " +
        "optional",
    ).toContain("listEpics");
  });

  test("the clause orders a REFUSAL rather than a mint on a shared project", () => {
    const clause = appendedClause();
    const sentence = sentenceWith(clause, "listEpics");
    expect(
      sentence,
      `on a shared project a provider WITHOUT the enumerator must refuse. Sentence read: ${JSON.stringify(sentence)}`,
    ).toMatch(/refus/i);
  });

  test("the refusal is raised in the NFR-10 canonical shape, naming project and missing op", () => {
    const clause = appendedClause();
    expect(clause, "the canonical refusal shape is NFR-10, as everywhere else").toContain("NFR-10");
    const sentence = sentenceWith(clause, "NFR-10");
    expect(
      sentence,
      `the shape must name the PROJECT. Sentence read: ${JSON.stringify(sentence)}`,
    ).toMatch(/project/i);
    expect(sentence, "…and the MISSING OPERATION").toMatch(/\bop(eration)?s?\b/i);
  });

  test("`grep -c listEpics skills/spec-write/SKILL.md` goes from 0 at HEAD to at least 1", () => {
    // KNOWN-POSITIVE CONTROL FIRST. A zero-hit grep with no control is a claim,
    // not a measurement: this proves the token is greppable and the cwd is right.
    expect(
      grepCount("listEpics", ATTACH_HELPER_REL),
      `${ATTACH_HELPER_REL} carries 7 \`listEpics\` lines at HEAD — if this is not 7, the ` +
        "grep below is measuring nothing",
    ).toBe(7);
    expect(grepCount("listEpics", SPEC_WRITE_REL)).toBeGreaterThanOrEqual(1);
  });
});

// ===========================================================================
// AC-STE-580.5 — `repo_tag` named exactly once.
// ===========================================================================

describe("AC-STE-580.5 — ticket identity and container identity read as one design", () => {
  test("the appended clause names `repo_tag` exactly once", () => {
    const hits = (appendedClause().match(/repo_tag/g) ?? []).length;
    expect(
      hits,
      "once, so ticket identity and container identity read as one design rather than " +
        "two schemes; twice is a second scheme restated",
    ).toBe(1);
  });

  test("line 177 as a whole names `repo_tag` exactly once — it carried zero at HEAD", () => {
    expect((line177().match(/repo_tag/g) ?? []).length).toBe(1);
  });
});

// ===========================================================================
// CONTROLS — the subject of the clause, and the loop it must NOT touch.
// ===========================================================================

describe("STE-580 controls — the measured asymmetry is still the subject", () => {
  test("the BIND path still REFUSES without listEpics/setParent", () => {
    expect(
      read(ATTACH_HELPER),
      "if this refusal moves, the clause's citation of it stops being true",
    ).toContain(
      'attachProjectMilestone: milestoneBinding === "epic" requires listEpics/setParent ops on the provider',
    );
  });

  test("the MINT path still records its find leg as optional", () => {
    expect(
      read(MINT_HELPER),
      "the asymmetry STE-580 closes in prose: the CREATE path degrades where the READ " +
        "path refuses",
    ).toContain("`listEpics` is optional; without it a mint simply has no find leg.");
  });

  test("the mint helper's IDEMPOTENCY comment is intact — STE-580 must not touch that loop", () => {
    const body = read(MINT_HELPER);
    expect(
      body,
      "mutation-verified: the find leg runs on the FIRST attempt as well as on retries",
    ).toContain("It runs on the FIRST attempt as well as on retries, which makes minting");
    expect(body).toContain("IDEMPOTENT");
    expect(
      body,
      "moving the find leg inside the retry's failure path restores duplicate minting",
    ).toContain("Moving this inside the retry's failure path would restore");
    expect(body).toContain("duplicate minting on exactly the re-run an operator is most likely to");
    expect(body).toContain("The find leg matches by NAME: at mint time no key exists to match on.");
  });
});
