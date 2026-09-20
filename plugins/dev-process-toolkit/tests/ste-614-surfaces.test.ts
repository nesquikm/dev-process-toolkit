// STE-614 AC.11 + AC.12 — the skills order the front door, and the announcing
// surfaces say what the evidence now is.
//
// Every scan here is paired with a control read from the FIXED base
// ff41e4e4 (never the moving `main` ref): a surface assertion that cannot fail
// on the pre-change bytes grades nothing.

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
/** The fixed base every "pre-change bytes" control reads from. */
const BASE = "ff41e4e42506cd119bf2b8b2866f9654fc113aec";

const FRONT_DOOR_ORDER =
  'bun run "${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/gate_receipt.ts"';

function read(rel: string): string {
  return readFileSync(join(PLUGIN_ROOT, rel), "utf-8");
}

/** The bytes of `rel` (plugin-relative) at the fixed base. */
function readAtBase(rel: string): string {
  const p = spawnSync(
    "git",
    ["show", `${BASE}:plugins/dev-process-toolkit/${rel}`],
    { cwd: REPO_ROOT, encoding: "utf-8", maxBuffer: 32 * 1024 * 1024 },
  );
  if (p.status !== 0) throw new Error(`git show ${rel} at ${BASE}: ${p.stderr}`);
  return p.stdout ?? "";
}

function frontMatter(body: string): string {
  const end = body.indexOf("\n---", 4);
  return body.slice(0, end + 4);
}

const SKILLS: Array<[string, string]> = [
  ["skills/gate-check/SKILL.md", "gate-check"],
  ["skills/tdd/SKILL.md", "tdd"],
  ["skills/spec-review/SKILL.md", "spec-review"],
];

describe("AC-STE-614.11 — each gate skill orders the front door exactly once", () => {
  for (const [rel, skill] of SKILLS) {
    test(`${rel} carries exactly one front-door order, naming \`${skill}\``, () => {
      const body = read(rel);
      const lines = body.split("\n").filter((l) => l.includes(FRONT_DOOR_ORDER));
      expect({ rel, count: lines.length }).toEqual({ rel, count: 1 });
      expect(lines[0]).toContain(skill);
      // The other two skill names must not ride along on the same line.
      for (const [, other] of SKILLS) {
        if (other === skill) continue;
        if (other === "gate-check" && skill === "spec-review") continue;
        expect({ rel, other, hit: lines[0]!.includes(` ${other}`) })
          .toEqual({ rel, other, hit: false });
      }
    });

    test(`CONTROL — ${rel} carried no such order at the fixed base`, () => {
      expect(readAtBase(rel).includes(FRONT_DOOR_ORDER)).toBe(false);
    });
  }

  test("in gate-check the order sits in the paragraph BEFORE the first `##` section", () => {
    const body = read("skills/gate-check/SKILL.md");
    const firstSection = body.indexOf("\n## ");
    expect(firstSection).toBeGreaterThan(0);
    expect(body.slice(0, firstSection).includes(FRONT_DOOR_ORDER)).toBe(true);
  });

  test("gate-check's `argument-hint` frontmatter line carries the optional path", () => {
    const fm = frontMatter(read("skills/gate-check/SKILL.md"));
    const hint = fm.split("\n").find((l) => l.startsWith("argument-hint:"));
    expect(hint).toBeDefined();
    expect(hint).toContain("path");
    expect(readAtBase("skills/gate-check/SKILL.md")).not.toContain(hint!);
  });

  test("gate-check's SKILL.md measures at most 358 split-lines", () => {
    expect(read("skills/gate-check/SKILL.md").split("\n").length).toBeLessThanOrEqual(358);
  });

  for (const [rel] of SKILLS.slice(1)) {
    test(`in ${rel} the order sits inside step 1`, () => {
      const body = read(rel);
      const at = body.indexOf(FRONT_DOOR_ORDER);
      const step1 = body.search(/^(#+\s*)?(Step\s*1|1\.)/m);
      expect(step1).toBeGreaterThanOrEqual(0);
      expect(at).toBeGreaterThan(step1);
      const step2 = body.search(/^(#+\s*)?(Step\s*2|2\.)/m);
      if (step2 > 0) expect(at).toBeLessThan(step2);
    });
  }

  test("spec-review's `allowed-tools` gains `Bash(bun run:*)`", () => {
    const fm = frontMatter(read("skills/spec-review/SKILL.md"));
    expect(fm).toContain("Bash(bun run:*)");
    expect(frontMatter(readAtBase("skills/spec-review/SKILL.md"))).not.toContain("Bash(bun run:*)");
  });

  test("no `STE-<N>` token is added anywhere under skills/", () => {
    const count = (body: string): number => (body.match(/STE-\d+/g) ?? []).length;
    const now = spawnSync(
      "bash",
      ["-c", `grep -rho 'STE-[0-9][0-9]*' '${join(PLUGIN_ROOT, "skills")}' | wc -l`],
      { encoding: "utf-8" },
    );
    const base = spawnSync(
      "bash",
      [
        "-c",
        `git -C '${REPO_ROOT}' grep -rho 'STE-[0-9][0-9]*' ${BASE} -- 'plugins/dev-process-toolkit/skills' | wc -l`,
      ],
      { encoding: "utf-8" },
    );
    const nowN = Number((now.stdout ?? "0").trim());
    const baseN = Number((base.stdout ?? "0").trim());
    expect(nowN).toBeLessThanOrEqual(baseN);
    // CONTROL — a scan that found nothing at the base would pass vacuously only
    // if the corpus were empty; `count` proves the matcher itself works.
    expect(count("STE-1 STE-22")).toBe(2);
  });

  test("the audit fork and the spec-reviewer agent keep byte-identical frontmatter", () => {
    for (const rel of ["skills/spec-review-audit/SKILL.md", "agents/spec-reviewer.md"]) {
      expect({ rel, fm: frontMatter(read(rel)) })
        .toEqual({ rel, fm: frontMatter(readAtBase(rel)) });
    }
  });

  test("the front-door order is written portably, through ${CLAUDE_PLUGIN_ROOT}", () => {
    for (const [rel] of SKILLS) {
      const line = read(rel).split("\n").find((l) => l.includes(FRONT_DOOR_ORDER))!;
      expect({ rel, abs: line.includes("/Users/") || line.includes("plugins/dev-process-toolkit/adapters") })
        .toEqual({ rel, abs: false });
    }
  });
});

const SURFACES = [
  "docs/hooks-reference.md",
  "docs/honored-contracts.md",
  "templates/CLAUDE.md.template",
  "skills/pr/SKILL.md",
  "docs/setup-reference.md",
  "docs/workflow-overview.md",
];

/** A line that states the evidence is the Skill call PLUS its receipt in the repo. */
/**
 * Does this surface state THIS FR's rule: the evidence is the Skill call plus
 * its gate receipt in the repository being committed to or PR'd?
 *
 * Scoped to the GATE receipt's own subject (amended during STE-614). The first
 * form — any "receipt" on a line with any "repository" — was matched at the
 * fixed base by M_947c79's TRACKER-receipt prose, which three of these six
 * surfaces already carried, so the control could never go red for them: it
 * graded the wrong subject. Naming one of the gate surfaces on the same line
 * is what separates the two receipts. Measured: 0 matches at the base in all
 * six files, at least one in each of them now.
 */
function statesReceiptRule(body: string): boolean {
  return body
    .split("\n")
    .some(
      (l) =>
        /receipt/i.test(l) &&
        /(gate receipt|gate-check|\/tdd|spec-review|gate skill|commit gate|gate run)/i.test(l),
    );
}

describe("AC-STE-614.12 — the announcing surfaces state the receipt rule", () => {
  for (const rel of SURFACES) {
    test(`${rel} states that the evidence is the Skill call plus its receipt in that repository`, () => {
      expect({ rel, states: statesReceiptRule(read(rel)) }).toEqual({ rel, states: true });
    });

    test(`CONTROL — ${rel} states no such thing at the fixed base`, () => {
      const base = readAtBase(rel);
      expect(base.length).toBeGreaterThan(0);
      expect({ rel, states: statesReceiptRule(base) }).toEqual({ rel, states: false });
    });

    test(`${rel} shows the \`repo=\` form wherever the red-before proof is described`, () => {
      const body = read(rel);
      if (!body.includes("dpt-red-before-proof:")) return;
      expect({ rel, form: body.includes("repo=") }).toEqual({ rel, form: true });
    });
  }

  test("docs/hooks-reference.md states the harness-absent case as the ONE fail-open leg (AC-STE-614.2)", () => {
    const body = read("docs/hooks-reference.md");
    expect(/fail-open/i.test(body)).toBe(true);
    expect(
      body.split("\n").some((l) => /fail-open/i.test(l) && /(harness|transcript|stdin)/i.test(l)),
    ).toBe(true);
  });

  test("the quoted refusal blocks in docs/hooks-reference.md carry the new receipt refusal and its remedy", () => {
    const body = read("docs/hooks-reference.md");
    const refusals = body.split("\n").filter((l) => l.trimStart().startsWith("Refusing:"));
    expect(refusals.length).toBeGreaterThan(0);
    expect(refusals.some((l) => /receipt/i.test(l))).toBe(true);
    const remedies = body.split("\n").filter((l) => l.trimStart().startsWith("Remedy:"));
    expect(remedies.some((l) => l.includes("/dev-process-toolkit:gate-check"))).toBe(true);
  });

  test("tests/m_a41431-ste-573-blocking-gate-announcement.test.ts stays byte-identical to the base", () => {
    const rel = "tests/m_a41431-ste-573-blocking-gate-announcement.test.ts";
    expect(read(rel)).toEqual(readAtBase(rel));
  });

  test("tests/_blocking_gates.ts is unedited by this FR", () => {
    expect(read("tests/_blocking_gates.ts")).toEqual(readAtBase("tests/_blocking_gates.ts"));
  });

  test("tests/hook-session-lib.test.ts stays green UNEDITED, and session.ts keeps one readFileSync", () => {
    expect(read("tests/hook-session-lib.test.ts"))
      .toEqual(readAtBase("tests/hook-session-lib.test.ts"));
    const lib = read("templates/hooks/_lib/session.ts");
    expect((lib.match(/readFileSync\(/g) ?? []).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-614.12, review round: "a test compares them with the emitted stderr".
// The suite greps the manual's own lines but never ran a hook, so the quoted
// blocks could drift from the shipped refusal and nothing would notice. This
// runs the REAL refusal through the shipped module and compares it, clause by
// clause, with the manual's quoted text.
// ---------------------------------------------------------------------------
describe("AC-STE-614.12 review — the manual's quoted refusals match the emitted stderr", () => {
  /** The manual's placeholders, filled with the values the module is handed. */
  const WORDS = {
    subject: "dev-process-toolkit:gate-check",
    root: "/s/be",
    where: "/s/be/.dpt/ledger/receipts/sess-1",
    skipped: "",
    claimant: "/s/fe",
    named: "/s/fe",
  };

  /** A doc clause with its `<placeholder>`s substituted for this fixture's values. */
  const filled = (clause: string): string =>
    clause
      .replace(/<skill>/g, WORDS.subject)
      .replace(/<store>/g, WORDS.where)
      .replace(/<root>/g, WORDS.root)
      .replace(/<other checkout>/g, WORDS.named)
      .replace(/<other skill>/g, "dev-process-toolkit:tdd")
      .replace(/, so nothing shows …$/, "");

  test("each row of the manual's named-states table is a real prefix of the module's own sentence", async () => {
    const doc = read("docs/hooks-reference.md");
    const rows = doc
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("| ") && l.includes("so nothing shows"))
      .map((l) => l.split("|")[2]!.trim().replace(/^`|`$/g, ""));
    // Non-vacuity: the table must actually have been found and parsed.
    expect(rows.length).toBeGreaterThanOrEqual(3);

    const { MISS_PROSE_FOR_TEST } = (await import("../adapters/_shared/src/gate_receipt")) as unknown as {
      MISS_PROSE_FOR_TEST: () => Record<string, (w: typeof WORDS) => string>;
    };
    const prose = MISS_PROSE_FOR_TEST();
    const emitted = [
      prose["no-receipt"]!(WORDS),
      prose["wrong-subject"]!({ ...WORDS, named: "dev-process-toolkit:tdd" }),
      prose["foreign-root"]!(WORDS),
      prose["store-unreadable"]!(WORDS),
    ];
    // Every row must be matched by SOME state, and every state must be in the
    // table: a row the module dropped and a state the manual never documented
    // are the same drift seen from two sides.
    expect(rows.length).toBe(emitted.length);
    for (const row of rows) {
      const want = filled(row);
      expect({ row, matched: emitted.some((e) => e.startsWith(want)) }).toEqual({ row, matched: true });
    }
  });
});
