// STE-881 (M_43bc84) — `/spec-write --seed <file>`: the skill text, the
// resolver-entry preamble rule, and the pins they move.
//
//   AC.1  parsed in the preamble beside --no-tech / --bug, routing unchanged;
//         the three unreadable-file refusals before the first question
//   AC.2  the seed is reference data; answered questions are not asked
//   AC.3  the draft-gate preview marks seeded answers; nothing written before it
//   AC.4  the seed never stands in for the marker or a <dpt:answers>v1 block
//   AC.5  `spec_write_seed_applied` in the closing summary and the § 7 map
//   AC.6  the argument hint and the resolver-entry preamble section name the flag
//   AC.7  the full-suite gate (orchestrator's run; no dedicated test)
//
// Budget: the FR's Technical Design gives the skill one clause (inline, in the
// § 0b flag paragraph) and one § 7 map row, so skills/spec-write/SKILL.md grows
// by exactly one line (338 -> 339 split-lines) and gains no STE-<n> token. The
// five exact-count pins and the STE-721 trunk-relative pin are amended in this
// RED pass with `Amended by AC-STE-881.5 (M_43bc84)`; the rows below assert
// those amendments are present.
//
// The token is registered in the § 7 map only (the `report_issue_retro_seeded`
// precedent): CANONICAL_CAPABILITY_KEYS stays where it is, so the skill text
// must not phrase it as an unregistered `MUST emit` directive — the
// closing_summary_capability_keys probe stays clean.

import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { specWriteStep7Map } from "./_skill-md";

const PLUGIN_ROOT = resolve(import.meta.dir, "..");
const REPO_ROOT = resolve(PLUGIN_ROOT, "..", "..");
const SKILL_REL = "skills/spec-write/SKILL.md";
const DOC_REL = "docs/resolver-entry.md";
const HEAD_SHA = "0d1dc625"; // the M_43bc84 spec commit; STE-881 not yet implemented

const read = (rel: string): string => readFileSync(join(PLUGIN_ROOT, rel), "utf-8");
const atHead = (rel: string): string =>
  execFileSync("git", ["-C", REPO_ROOT, "show", `${HEAD_SHA}:plugins/dev-process-toolkit/${rel}`], {
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
  });
const steTokens = (s: string): number => (s.match(/STE-\d+/g) ?? []).length;

const HINT = "[--no-tech] [--bug] [--seed <file>] [--fetch | --no-fetch] [requirements | technical | testing | plan | all]";
const HINT_HEAD = "[--no-tech] [--bug] [--fetch | --no-fetch] [requirements | technical | testing | plan | all]";

/** The `## Preamble flags` section of the resolver-entry doc, heading through the next `## `. */
function preambleSection(doc: string): string {
  const start = doc.indexOf("\n## Preamble flags");
  if (start < 0) return "";
  const rest = doc.slice(start + 1);
  const end = rest.slice(3).search(/\n## /);
  return end < 0 ? rest : rest.slice(0, end + 3);
}

/** The paragraphs (blank-line separated) of `text` that name `--seed`. */
function seedParagraphs(text: string): string[] {
  return text.split(/\n\s*\n/).filter((p) => p.includes("--seed"));
}

/** `### 0b.` through the next `### ` heading of the skill. */
function section0b(skill: string): string {
  const start = skill.indexOf("\n### 0b. ");
  if (start < 0) return "";
  const rest = skill.slice(start + 1);
  const end = rest.slice(4).search(/\n### /);
  return end < 0 ? rest : rest.slice(0, end + 4);
}

/** Every line of the skill's § 0b that names `--seed`. */
const skillSeedLines = (skill: string): string[] => section0b(skill).split("\n").filter((l) => l.includes("--seed"));

/** The seed rule as written: the § 0b clause plus the resolver-entry preamble paragraphs. */
const seedRule = (): string =>
  [...skillSeedLines(read(SKILL_REL)), ...seedParagraphs(preambleSection(read(DOC_REL)))].join("\n\n");

const docSeed = (): string => seedParagraphs(preambleSection(read(DOC_REL))).join("\n\n");

function mapRow(map: string, key: string): string[] {
  return map.split("\n").filter((l) => l.startsWith(`| \`${key}\``) || l.startsWith(`| \`${key}\` `));
}

// ===========================================================================

describe("helpers (falsifiers)", () => {
  test("preambleSection stops at the next ## heading and seedParagraphs ignores the --bug paragraph", () => {
    const doc = [
      "# T",
      "",
      "## Preamble flags (`/spec-write`)",
      "",
      "`/spec-write --bug` is parsed here.",
      "",
      "## Decision table",
      "",
      "`--seed` mentioned outside the section.",
    ].join("\n");
    const sec = preambleSection(doc);
    expect(sec).toContain("--bug");
    expect(sec).not.toContain("Decision table");
    expect(seedParagraphs(sec)).toEqual([]);
  });

  test("CONTROL: at the spec commit the preamble section and § 0b name no --seed", () => {
    expect(seedParagraphs(preambleSection(atHead(DOC_REL)))).toEqual([]);
    expect(skillSeedLines(atHead(SKILL_REL))).toEqual([]);
    expect(preambleSection(atHead(DOC_REL))).toContain("`/spec-write --bug`");
  });
});

describe("AC-STE-881.1 parsed in the preamble; unreadable seeds refuse before the first question", () => {
  test("the resolver-entry preamble section has a `/spec-write --seed <file>` paragraph", () => {
    expect(docSeed()).toContain("`/spec-write --seed <file>`");
  });

  test("it is parsed in the resolver-entry preamble beside `--no-tech` and `--bug`", () => {
    expect(docSeed()).toMatch(/parsed in the resolver-entry preamble beside `--no-tech` and `--bug`/);
  });

  test("it does not change resolver `kind` routing", () => {
    expect(docSeed()).toMatch(/does not change resolver `kind` routing/);
  });

  test("it names all three refusal conditions: missing, not a regular file, not readable as text", () => {
    const t = docSeed();
    expect({ missing: /does not exist/.test(t), notRegular: /not a regular file/.test(t), notText: /cannot be read as text/.test(t) }).toEqual({
      missing: true,
      notRegular: true,
      notText: true,
    });
  });

  test("the refusal is NFR-10-shaped, before the first question, with zero tracker writes and zero files", () => {
    const t = docSeed();
    expect({ nfr10: /NFR-10/.test(t), first: /before the first question/.test(t), zero: /zero tracker writes and zero files/.test(t) }).toEqual({
      nfr10: true,
      first: true,
      zero: true,
    });
  });

  test("the skill's § 0b carries a `--seed <file>` clause pointing at docs/resolver-entry.md § Preamble flags", () => {
    const lines = skillSeedLines(read(SKILL_REL));
    const pointing = lines.filter((l) => l.includes("`--seed <file>`") && l.includes("docs/resolver-entry.md` § Preamble flags"));
    expect(pointing.length).toBeGreaterThanOrEqual(1);
  });
});

describe("AC-STE-881.2 the seed is reference data; an answered question is not asked", () => {
  test("the seed is read as reference data, not instructions", () => {
    expect(seedRule()).toMatch(/reference data, not instructions/i);
  });

  test("a question whose answer the seed states is not asked", () => {
    expect(seedRule()).toMatch(/question whose answer the seed states is not asked/i);
  });

  test("a question the seed does not answer is asked as today", () => {
    expect(seedRule()).toMatch(/(does not answer|leaves open)[^.]*asked as today/i);
  });
});

describe("AC-STE-881.3 seeded answers are marked in the draft-gate preview; nothing is written before it", () => {
  test("the draft-gate preview marks every answer taken from the seed", () => {
    expect(seedRule()).toMatch(/draft-gate preview marks (every|each) answer taken from the seed/i);
  });

  test("nothing from the seed is written to a file or the tracker before that gate", () => {
    expect(seedRule()).toMatch(/nothing from the seed is written to a file or the tracker before (that|the draft) gate/i);
  });
});

describe("AC-STE-881.4 the seed never stands in for the marker or an answers block; gates unchanged", () => {
  test("the seed never stands in for the auto-approve marker or a `<dpt:answers>v1` block", () => {
    expect(seedRule()).toMatch(/never stands in for the auto-approve marker or an? `<dpt:answers>v1` block/i);
  });

  test("under non-tty stdin the refusal rules are unchanged", () => {
    expect(seedRule()).toMatch(/non-tty[^.]*refusal rules (are|stay) unchanged/i);
  });

  test("the draft, milestone and commit gates fire exactly as without the flag", () => {
    expect(seedRule()).toMatch(/draft, milestone and commit gates fire exactly as without the flag/i);
  });

  test("the first-turn and alternate-trigger scans stay clean on the repo", async () => {
    const { runSpecWriteFirstTurnDriftScanProbe } = await import("../adapters/_shared/src/spec_write_first_turn_drift_scan");
    const { runSpecWriteAlternateTriggerScanProbe } = await import("../adapters/_shared/src/spec_write_alternate_trigger_scan");
    const a = await runSpecWriteFirstTurnDriftScanProbe(REPO_ROOT);
    const b = await runSpecWriteAlternateTriggerScanProbe(REPO_ROOT);
    expect({ first: a.violations.map((v) => v.note), alt: b.violations.map((v) => v.note) }).toEqual({ first: [], alt: [] });
  });
});

describe("AC-STE-881.5 spec_write_seed_applied: closing summary + § 7 map", () => {
  test("the § 7 map carries exactly one `spec_write_seed_applied` row", () => {
    const map = specWriteStep7Map(read(SKILL_REL));
    expect(mapRow(map, "spec_write_seed_applied")).toHaveLength(1);
  });

  test("the row's prose names the seed file and how many questions it answered", () => {
    const map = specWriteStep7Map(read(SKILL_REL));
    const row = mapRow(map, "spec_write_seed_applied")[0] ?? "";
    const prose = row.split("|").slice(2).join("|");
    expect({ file: /<(seed-)?file>/.test(prose), count: /<N>/.test(prose) }).toEqual({ file: true, count: true });
  });

  test("outside the map, the skill says the closing summary emits the literal token", () => {
    const skill = read(SKILL_REL);
    const map = specWriteStep7Map(skill);
    const rest = skill.replace(map, "");
    const naming = rest.split("\n").filter((l) => l.includes("`spec_write_seed_applied`") && /closing summary/i.test(l));
    expect(naming.length).toBeGreaterThanOrEqual(1);
  });

  test("closing_summary_capability_keys reports clean on the repo (no unregistered MUST-emit directive)", async () => {
    const { runClosingSummaryCapabilityKeysProbe } = await import("../adapters/_shared/src/closing_summary_capability_keys");
    const r = await runClosingSummaryCapabilityKeysProbe(REPO_ROOT);
    expect(r.violations.map((v) => v.note)).toEqual([]);
  });
});

describe("AC-STE-881.6 the argument hint and the preamble-flags section name the flag", () => {
  test(`the /spec-write argument-hint is exactly ${HINT}`, () => {
    const m = read(SKILL_REL).match(/^argument-hint:\s*['"](.+?)['"]\s*$/m);
    expect(m?.[1]).toBe(HINT);
  });

  test("CONTROL: the spec commit's hint is the flagless one", () => {
    expect(atHead(SKILL_REL)).toContain(`argument-hint: '${HINT_HEAD}'`);
  });

  test("the resolver-entry `## Preamble flags (`/spec-write`)` section names `--seed <file>`", () => {
    const sec = preambleSection(read(DOC_REL));
    expect(sec.startsWith("## Preamble flags (`/spec-write`)")).toBe(true);
    expect(sec).toContain("--seed <file>");
  });
});

describe("budget: one new line, no STE token, and the amended pins", () => {
  test("skills/spec-write/SKILL.md gains exactly one split-line (the § 7 row), stays within the NFR-1 cap, and keeps its STE token count", () => {
    const body = read(SKILL_REL);
    expect(body.split("\n").length).toBe(339);
    expect(body.split("\n").length).toBeLessThanOrEqual(362);
    expect(steTokens(body)).toBe(54);
    expect(steTokens(body)).toBe(steTokens(atHead(SKILL_REL)));
  });

  const PINS = [
    "tests/ticket-ownership-shared.test.ts",
    "tests/spec-write-post-create-resync-prose.test.ts",
    "tests/orphan-listing-shared.test.ts",
    "tests/m_685ff6-ste-610-template.test.ts",
    "tests/create-front-door-shared.test.ts",
  ];

  for (const rel of PINS) {
    test(`${rel} pins 339 with the AC-STE-881.5 amendment and no longer pins the spec-write file at 338`, () => {
      const src = read(rel);
      const amended = src.split("\n").filter((l) => /\.toBe\(339\); \/\/ Amended by AC-STE-881\.5 \(M_43bc84\)/.test(l));
      expect({ rel, amended: amended.length }).toEqual({ rel, amended: 1 });
      expect({ rel, old: src.split("\n").filter((l) => /split\("\\n"\)\.length\)\.toBe\(338\)/.test(l)).length }).toEqual({ rel, old: 0 });
    });
  }

  test("the STE-721 trunk-relative pin reads trunk minus 19 with the AC-STE-881.5 amendment", () => {
    const src = read("tests/m_d1b4b7-ste-721-skill-text.test.ts");
    expect(src).toContain('expect(cur.split("\\n").length).toBe(base.split("\\n").length - 19); // Amended by AC-STE-881.5 (M_43bc84)');
    expect(src).not.toContain('expect(cur.split("\\n").length).toBe(base.split("\\n").length - 20);');
  });
});
