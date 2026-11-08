// STE-722 (M_d1b4b7) — the two retro offers in the continuation-offer
// registry, probe #85, their placement, and every pin the FR's § Counts moves.
//
// AC-STE-722.4  registry entries and anchors
// AC-STE-722.5  probe #85 clean, and a mutation per new span
// AC-STE-722.7  anchor order in both SKILL.md files
// AC-STE-722.9  the moved pins, read from the suites that hold them (this
//               file never edits them; it grades their required contents)
//
// All ids are synthetic.

import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  CONTINUATION_OFFERS,
  DRIVEN_OMISSION_CLAUSE,
  continuationOffer,
  drivenOmissionOccurrences,
  offersForSkill,
  runContinuationOfferAdoptionProbe,
} from "../adapters/_shared/src/continuation_offer";
import { GATE_REGISTRY, gateFor } from "../adapters/_shared/src/gate_class";
import {
  CLOSE_OUT_HEADING,
  DELIVER_ANCHOR,
  DELIVER_RETRO,
  DELIVER_SKILL,
  DELIVER_UPGRADE,
  IMPLEMENT_ANCHOR,
  IMPLEMENT_RETRO,
  IMPLEMENT_SKILL,
  IMPLEMENT_UPGRADE,
  PLUGIN,
  SRC,
  UPGRADE_QUESTION,
  cleanupTemps,
  read,
  tempDir,
} from "./_m_d1b4b7_ste722_fixture";

afterAll(cleanupTemps);

const IMPLEMENT_FILE = "plugins/dev-process-toolkit/skills/implement/SKILL.md";
const DELIVER_FILE = "plugins/dev-process-toolkit/skills/deliver/SKILL.md";
const SHIP_READY = "implement_ship_ready_close";
const TESTS = join(PLUGIN, "tests");
const splitCount = (text: string): number => text.split("\n").length;

// ===========================================================================
// AC-STE-722.4 — registry entries
// ===========================================================================

describe("AC-STE-722.4 registry entries", () => {
  for (const [id, skill, file, anchor] of [
    [IMPLEMENT_RETRO, "implement", IMPLEMENT_FILE, IMPLEMENT_ANCHOR],
    [DELIVER_RETRO, "deliver", DELIVER_FILE, DELIVER_ANCHOR],
  ] as const) {
    test(`AC-.4 ${id} is registered with its skill, anchor, runsWhenAccepted ["/retro"] and empty runsWhenDriven`, () => {
      const offer = continuationOffer(id);
      expect(offer).not.toBeNull();
      expect(offer!.id).toBe(id);
      expect(offer!.skill).toBe(skill);
      expect(offer!.file).toBe(file);
      expect(offer!.anchor).toBe(anchor);
      expect([...offer!.runsWhenAccepted]).toEqual(["/retro"]);
      expect([...offer!.runsWhenDriven]).toEqual([]);
      expect(typeof offer!.asks).toBe("string");
      expect(offer!.asks.trim().length).toBeGreaterThan(0);
    });

    test(`AC-.4 the ${id} anchor occurs exactly once in its SKILL.md`, () => {
      const body = read(join(PLUGIN, "..", "..", file));
      expect(body.split(anchor).length - 1, `${id} anchor occurrences`).toBe(1);
    });
  }
});

// ===========================================================================
// AC-STE-722.5 — probe #85
// ===========================================================================

describe("AC-STE-722.5 continuation_offer_adoption (probe #85)", () => {
  const repoRoot = join(PLUGIN, "..", "..");

  test("AC-.5 zero violations on the shipped tree, with both retro offers registered", () => {
    expect(continuationOffer(IMPLEMENT_RETRO)).not.toBeNull();
    expect(continuationOffer(DELIVER_RETRO)).not.toBeNull();
    const report = runContinuationOfferAdoptionProbe(repoRoot);
    expect(report.vacuous).toBe(false);
    expect(report.violations).toEqual([]);
  });

  function copySkills(): string {
    const root = tempDir("probe85");
    const skills = new Set([...CONTINUATION_OFFERS.map((o) => o.skill), "deliver"]);
    for (const skill of skills) {
      const dst = join(root, "plugins", "dev-process-toolkit", "skills", skill, "SKILL.md");
      mkdirSync(dirname(dst), { recursive: true });
      cpSync(join(PLUGIN, "skills", skill, "SKILL.md"), dst);
    }
    return root;
  }

  for (const [id, file] of [
    [IMPLEMENT_RETRO, IMPLEMENT_FILE],
    [DELIVER_RETRO, DELIVER_FILE],
  ] as const) {
    test(`AC-.5 MUTATION — deleting DRIVEN_OMISSION_CLAUSE from the ${id} span makes probe #85 report exactly that offer`, () => {
      const offer = continuationOffer(id);
      expect(offer).not.toBeNull();
      const root = copySkills();
      expect(runContinuationOfferAdoptionProbe(root).violations).toEqual([]);
      const target = join(root, file);
      const before = read(target);
      const anchorAt = before.indexOf(offer!.anchor);
      expect(anchorAt).toBeGreaterThanOrEqual(0);
      const clauseAt = before.indexOf(DRIVEN_OMISSION_CLAUSE, anchorAt);
      expect(clauseAt).toBeGreaterThan(anchorAt);
      writeFileSync(target, before.slice(0, clauseAt) + before.slice(clauseAt + DRIVEN_OMISSION_CLAUSE.length));
      const violations = runContinuationOfferAdoptionProbe(root).violations;
      expect(violations.length).toBe(1);
      expect(violations[0]!.file).toBe(file);
      expect(violations[0]!.message).toContain(`offer=${id}`);
    });
  }
});

// ===========================================================================
// AC-STE-722.7 — placement
// ===========================================================================

describe("AC-STE-722.7 anchor order", () => {
  test("AC-.7 implement: upgrade anchor < retro anchor < ship-ready anchor", () => {
    const body = read(IMPLEMENT_SKILL);
    const upgrade = body.indexOf(UPGRADE_QUESTION);
    const retro = body.indexOf(IMPLEMENT_ANCHOR);
    const shipReady = body.indexOf(continuationOffer(SHIP_READY)!.anchor);
    expect(upgrade).toBeGreaterThanOrEqual(0);
    expect(retro).toBeGreaterThan(upgrade);
    expect(shipReady).toBeGreaterThan(retro);
    // And before the ship-ready heading, on the upgrade offer's own line.
    expect(retro).toBeLessThan(body.indexOf("### Ship-ready close offer"));
    expect(body.lastIndexOf("\n", retro)).toBe(body.lastIndexOf("\n", upgrade));
  });

  test("AC-.7 deliver: the retro anchor sits inside the close-out section, after the upgrade anchor", () => {
    const body = read(DELIVER_SKILL);
    const start = body.indexOf(CLOSE_OUT_HEADING);
    expect(start).toBeGreaterThanOrEqual(0);
    const next = body.indexOf("\n## ", start + CLOSE_OUT_HEADING.length);
    const section = body.slice(start, next < 0 ? body.length : next);
    const upgrade = section.indexOf(UPGRADE_QUESTION);
    const retro = section.indexOf(DELIVER_ANCHOR);
    expect(upgrade).toBeGreaterThanOrEqual(0);
    expect(retro).toBeGreaterThan(upgrade);
  });
});

// ===========================================================================
// AC-STE-722.9 — the moved pins
// ===========================================================================

/** The text from `const <name>` to the first line closing its literal. */
function constBlock(text: string, name: string): string {
  const at = text.indexOf(`const ${name}`);
  if (at < 0) throw new Error(`no const ${name}`);
  const end = text.indexOf("\n];", at);
  const endObj = text.indexOf("\n};", at);
  const ends = [end, endObj].filter((n) => n > at);
  const stop = ends.length === 0 ? text.indexOf("\n", at) : Math.min(...ends);
  return text.slice(at, stop + 3);
}

/** The name of the const whose string value is `value`, in `text`. */
function constNamed(text: string, value: string): { name: string; line: string } | null {
  for (const line of text.split("\n")) {
    const m = new RegExp(`^const ([A-Z_]+) = "${value}";`).exec(line);
    if (m) return { name: m[1]!, line };
  }
  return null;
}

const lineWith = (text: string, needle: string | RegExp): string | undefined =>
  text.split("\n").find((l) => (typeof needle === "string" ? l.includes(needle) : needle.test(l)));

describe("AC-STE-722.9 the registry reads its new total", () => {
  test("AC-.9 CONTINUATION_OFFERS holds 12 entries; implement owns 4, deliver owns [upgrade, retro]", () => {
    expect(CONTINUATION_OFFERS.length).toBe(12);
    const implementIds = offersForSkill("implement").map((o) => o.id);
    expect(implementIds.length).toBe(4);
    expect(implementIds).toContain(IMPLEMENT_RETRO);
    expect(offersForSkill("deliver").map((o) => o.id)).toEqual([DELIVER_UPGRADE, DELIVER_RETRO]);
    expect(new Set(CONTINUATION_OFFERS.map((o) => o.skill)).size).toBe(6);
  });

  test("AC-.9 each skill carries one omission clause per offer it owns (implement 4, deliver 2)", () => {
    expect(drivenOmissionOccurrences(read(IMPLEMENT_SKILL))).toBe(4);
    expect(drivenOmissionOccurrences(read(DELIVER_SKILL))).toBe(2);
  });

  test("AC-.9 the registry's doc comment states the new total", () => {
    const src = read(join(SRC, "continuation_offer.ts"));
    const at = src.indexOf("export const CONTINUATION_OFFERS");
    const doc = src.slice(src.lastIndexOf("/**", at), at);
    expect(doc).toMatch(/\b(?:twelve|12)\b/i);
    expect(doc).not.toMatch(/\bseven shipped offers\b/i);
  });

  test("AC-.9 GATE_REGISTRY gains both offers as mechanical gates, after the two upgrade-offer entries", () => {
    const ids = GATE_REGISTRY.map((g) => g.id);
    const up = ids.indexOf(DELIVER_UPGRADE);
    expect(ids.indexOf(IMPLEMENT_UPGRADE)).toBe(up - 1);
    expect(ids.indexOf(IMPLEMENT_RETRO)).toBe(up + 1);
    expect(ids.indexOf(DELIVER_RETRO)).toBe(up + 2);
    const impl = gateFor(IMPLEMENT_RETRO);
    expect(impl?.gateClass).toBe("mechanical");
    expect(impl?.summary).toBe("confirm a read-only retrospective runs for the finished scope");
    const del = gateFor(DELIVER_RETRO);
    expect(del?.gateClass).toBe("mechanical");
    expect(del?.summary ?? "").toMatch(/retrospective/);
    expect(del?.summary ?? "").toMatch(/delivered milestones/);
  });
});

describe("AC-STE-722.9 pins in tests/m143-ste-551-continuation-offers.test.ts", () => {
  const text = (): string => read(join(TESTS, "m143-ste-551-continuation-offers.test.ts"));

  test("AC-.9 the two ids are named constants beside IMPLEMENT_UPGRADE and DELIVER_UPGRADE, each marked", () => {
    for (const id of [IMPLEMENT_RETRO, DELIVER_RETRO]) {
      const c = constNamed(text(), id);
      expect(c, `a const holding "${id}"`).not.toBeNull();
      expect(c!.line).toContain("Amended by AC-STE-722.9");
    }
  });

  test("AC-.9 ALL_OFFER_IDS, SHIPPED_ANCHORS and CHAIN_REACHED_IDS carry the retro offers", () => {
    const t = text();
    const impl = constNamed(t, IMPLEMENT_RETRO)!.name;
    const del = constNamed(t, DELIVER_RETRO)!.name;
    const all = constBlock(t, "ALL_OFFER_IDS");
    expect(all).toMatch(new RegExp(`\\b${impl}\\b.*Amended by AC-STE-722\\.9`));
    expect(all).toMatch(new RegExp(`\\b${del}\\b.*Amended by AC-STE-722\\.9`));
    const anchors = constBlock(t, "SHIPPED_ANCHORS");
    expect(anchors).toContain(`[${impl}]`);
    expect(anchors).toContain(`[${del}]`);
    expect(anchors).toContain("Amended by AC-STE-722.9");
    // The anchors themselves are spelled in the suite (inline or as a named constant).
    expect(t).toContain(IMPLEMENT_ANCHOR);
    expect(t).toContain(DELIVER_ANCHOR);
    const chain = lineWith(t, /^const CHAIN_REACHED_IDS/);
    expect(chain).toBeDefined();
    expect(chain!).toMatch(new RegExp(`\\b${del}\\b`));
    expect(chain!).toMatch(/\bDELIVER_UPGRADE\b/);
  });

  test("AC-.9 the length, per-skill and operator-turn pins read their new values with their markers", () => {
    const t = text();
    const len = lineWith(t, "expect(CONTINUATION_OFFERS.length).toBe(");
    expect(len).toMatch(/toBe\(12\)/);
    expect(len).toContain("Amended by AC-STE-712.4");
    expect(len).toContain("Amended by AC-STE-722.9");
    const impl = constNamed(t, IMPLEMENT_RETRO)!.name;
    const del = constNamed(t, DELIVER_RETRO)!.name;
    const implList = t.slice(t.indexOf('offersForSkill("implement").map((o) => o.id).sort()'));
    expect(implList.slice(0, 300)).toMatch(new RegExp(`\\b${impl}\\b`));
    const delList = lineWith(t, 'expect(offersForSkill("deliver").map((o) => o.id)).toEqual(');
    expect(delList).toMatch(new RegExp(`\\[DELIVER_UPGRADE, ${del}\\]`));
    expect(delList).toContain("Amended by AC-STE-722.9");
    const implCount = lineWith(t, 'expect(offersForSkill("implement").length).toBe(');
    expect(implCount).toMatch(/toBe\(4\).*Amended by AC-STE-722\.9/);
    const delCount = lineWith(t, 'expect(offersForSkill("deliver").length).toBe(');
    expect(delCount).toMatch(/toBe\(2\).*Amended by AC-STE-722\.9/);
    const turns = lineWith(t, "expect(run.operatorTurns.length).toBe(");
    expect(turns).toMatch(/toBe\(10\).*Amended by AC-STE-722\.9/);
    // The distinct-skill pin does not move.
    expect(lineWith(t, "new Set(CONTINUATION_OFFERS.map((o) => o.skill)).size).toBe(")).toMatch(/toBe\(6\)/);
  });
});

describe("AC-STE-722.9 pins in tests/m_94e6f7-ste-712-upgrade-offer.test.ts", () => {
  const text = (): string => read(join(TESTS, "m_94e6f7-ste-712-upgrade-offer.test.ts"));

  test("AC-.9 the deliver id list becomes [DELIVER_OFFER, \"deliver_close_retro_offer\"], marked", () => {
    const line = lineWith(text(), 'expect(offersForSkill("deliver").map((o) => o.id)).toEqual(');
    expect(line).toContain('[DELIVER_OFFER, "deliver_close_retro_offer"]');
    expect(line).toContain("Amended by AC-STE-722.9");
  });

  test("AC-.9 the omission-clause row reads implement 4 and deliver 2, its title included", () => {
    const t = text();
    expect(t).toContain("each skill carries one omission clause per offer it owns (implement 4, deliver 2)");
    expect(t).not.toContain("(implement 3, deliver 1)");
    const at = t.indexOf("(implement 4, deliver 2)");
    const row = t.slice(at, t.indexOf("\n  });", at));
    expect(row).toMatch(/offersForSkill\("implement"\)\.length\)\.toBe\(4\)/);
    expect(row).toMatch(/drivenOmissionOccurrences\(read\(DELIVER_SKILL\)\)\)\.toBe\(2\)/);
    expect(row).toContain("Amended by AC-STE-722.9");
  });
});

describe("AC-STE-722.9 frozen gate-id lists and the admitted marker", () => {
  for (const [file, name] of [
    ["m143-ste-552-chain-gate-registration.test.ts", "EXPECTED_NEW_GATE_IDS"],
    ["m133-ste-515-gate-registration.test.ts", "POST_FR_ADDED_IDS"],
  ] as const) {
    test(`AC-.9 ${name} in ${file} gains both retro ids, marked`, () => {
      const block = constBlock(read(join(TESTS, file)), name);
      expect(block).toContain(`"${IMPLEMENT_RETRO}"`);
      expect(block).toContain(`"${DELIVER_RETRO}"`);
      expect(block).toContain("Amended by AC-STE-722.9");
    });
  }

  test("AC-.9 ADMITTED_MARKER in tests/m_79b1f6-ste-590-offers-ask-the-gate.test.ts admits 722.9", () => {
    const line = lineWith(read(join(TESTS, "m_79b1f6-ste-590-offers-ask-the-gate.test.ts")), /^const ADMITTED_MARKER = \//);
    expect(line).toBeDefined();
    const source = /^const ADMITTED_MARKER = \/(.*)\/([a-z]*);/.exec(line!);
    expect(source).not.toBeNull();
    const re = new RegExp(source![1]!, source![2]);
    expect(re.test("// Amended by AC-STE-722.9 (266 -> 268)")).toBe(true);
    expect(re.test("// Amended by AC-STE-712.7 (M_94e6f7)")).toBe(true);
    expect(re.test("// Amended by AC-STE-722.8")).toBe(false);
  });
});

describe("AC-STE-722.9 skills/deliver/SKILL.md at 268 split-lines", () => {
  test("AC-.9 the deliver SKILL.md measures 268 split-lines (266 + paragraph + blank)", () => {
    expect(splitCount(read(DELIVER_SKILL))).toBe(268);
  });

  test("AC-.9 DELIVER_SKILL_LINE_COUNT reads 268 with both amendment comments", () => {
    const t = read(join(TESTS, "m_8f07e0-ste-582-target-repo-refusal.test.ts"));
    const at = t.indexOf("const DELIVER_SKILL_LINE_COUNT");
    expect(t.slice(at).split("\n")[0]).toBe("const DELIVER_SKILL_LINE_COUNT = 268;");
    const head = t.slice(Math.max(0, at - 400), at);
    expect(head).toContain("Amended by AC-STE-712.7");
    expect(head).toContain("// Amended by AC-STE-722.9 (266 -> 268)");
  });

  test("AC-.9 the ste-584 splitCount(file) deliver row reads 268 with both amendment comments", () => {
    const t = read(join(TESTS, "m_8f07e0-ste-584-awaiting-siblings.test.ts"));
    const at = t.indexOf("deliver SKILL.md keeps its");
    expect(at).toBeGreaterThanOrEqual(0);
    const row = t.slice(at, t.indexOf("\n  });", at));
    expect(row).toContain("expect(splitCount(file)).toBe(268)");
    expect(row).toContain("Amended by AC-STE-712.7");
    expect(row).toContain("// Amended by AC-STE-722.9 (266 -> 268)");
    expect(row).not.toContain("toBe(266)");
  });

  test("AC-.9 the added deliver retro paragraph carries no STE-<n> token", () => {
    const body = read(DELIVER_SKILL);
    const at = body.indexOf(DELIVER_ANCHOR);
    expect(at).toBeGreaterThanOrEqual(0);
    const start = body.lastIndexOf("\n\n", at) + 2;
    const end = body.indexOf("\n\n", at);
    const paragraph = body.slice(start, end < 0 ? body.length : end);
    expect(paragraph).not.toMatch(/STE-\d+/);
    expect(paragraph).not.toContain(UPGRADE_QUESTION);
  });
});
