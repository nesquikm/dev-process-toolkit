// STE-612 AC-STE-612.9 (and AC-STE-612.6's ordering clause) — the prose is
// edited in place.
//
// § 0c of docs/setup-reference.md orders the flag as the repoint command, then
// step 7f, then `--verify`; the command is the one caller of the sub-section
// writer on that route; each precondition row names the check its command line
// performs (the `REFUSE` verdict it prints); the MEASURED repository-pair
// values that proved wrong — row 3's issue types, row 6's label range — are
// gone; a row says the old project is never archived or deleted.
// skills/setup/SKILL.md line 37 names the command in place, with no new line
// and no new STE token anywhere under skills/.
//
// The sibling suite tests/m_840a06-ste-581-repoint-instrument.test.ts pins
// § 0c's row phrases; none of its pins encodes a removed MEASURED value, so
// none needed amending here.
//
// Controls (the caps) are labelled `(control)`.

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const read = (rel: string) => readFileSync(join(PLUGIN_ROOT, rel), "utf-8");
const SETUP_REFERENCE = "docs/setup-reference.md";
const SETUP_SKILL = "skills/setup/SKILL.md";
const COMMAND = "repoint_tracker_binding.ts";
const STE_TOKEN_RE = /\b(?:STE|AC-STE)-\d+(?:\.\d+)?\b/g;

/** § 0c: from its `### § 0c` heading to the next `## ` heading (includes the preconditions). */
function section0c(): string {
  const ls = read(SETUP_REFERENCE).split("\n");
  const start = ls.findIndex((l) => /^### § 0c\b/.test(l));
  if (start < 0) return "";
  let end = ls.length;
  for (let i = start + 1; i < ls.length; i++) {
    if (/^## /.test(ls[i]!)) {
      end = i;
      break;
    }
  }
  return ls.slice(start, end).join("\n");
}

/** The numbered precondition rows, keyed by their number. */
function rows(): Map<number, string> {
  const out = new Map<number, string>();
  const body = section0c();
  const at = body.indexOf("### Repoint preconditions");
  for (const l of body.slice(at < 0 ? body.length : at).split("\n")) {
    const m = /^(\d+)\.\s+(.*)$/.exec(l);
    if (m) out.set(Number(m[1]), m[2]!);
  }
  return out;
}

/** The paragraphs of § 0c (blank-line separated). */
const paragraphs = () => section0c().split(/\n\s*\n/);

describe("AC-STE-612.9 / AC-STE-612.6 — § 0c orders the command, then 7f, then --verify", () => {
  test("(control) § 0c and seven precondition rows exist", () => {
    expect(section0c()).not.toBe("");
    for (let n = 1; n <= 7; n++) expect(rows().has(n), `row ${n}`).toBe(true);
  });

  test("§ 0c names the repoint command", () => {
    expect(section0c()).toContain(COMMAND);
  });

  test("one paragraph orders the command, then step 7f, then `--verify` — in that order", () => {
    const ordered = paragraphs().filter((p) => {
      const c = p.indexOf(COMMAND);
      if (c < 0) return false;
      const f = p.indexOf("7f", c);
      if (f < 0) return false;
      return p.indexOf("--verify", f) > f;
    });
    expect(ordered.length).toBeGreaterThan(0);
  });

  test("`--verify` is the last step: no paragraph orders anything after it on the flag's route", () => {
    const p = paragraphs().find((x) => x.includes(COMMAND) && x.includes("--verify"));
    expect(p, "a paragraph naming the command and --verify").toBeDefined();
    expect(p!).toMatch(/--verify[\s\S]{0,200}\blast\b|\blast\b[\s\S]{0,200}--verify/i);
  });

  test("the command is the one caller of the sub-section writer on that route", () => {
    const p = paragraphs().find((x) => x.includes(COMMAND) && /tracker_binding_write|writeTrackerSubsection/.test(x));
    expect(p, "a paragraph naming both the command and the writer").toBeDefined();
    expect(p!).toMatch(/\b(one|only|sole)\b[\s\S]{0,80}\bcaller\b|\bcaller\b[\s\S]{0,80}\b(one|only|sole)\b/i);
  });
});

describe("AC-STE-612.9 — the precondition rows name the check the command performs", () => {
  for (let n = 1; n <= 7; n++) {
    test(`row ${n} names the verdict its command line prints (REFUSE)`, () => {
      expect(rows().get(n) ?? "").toContain("REFUSE");
    });
  }

  test("row 3 no longer asserts the MEASURED issue types (Story id 11108 / Task)", () => {
    const r3 = rows().get(3) ?? "";
    expect(r3).not.toBe("");
    expect(r3).not.toContain("11108");
    expect(r3).not.toMatch(/MEASURED/);
  });

  test("row 6 no longer asserts the MEASURED label range", () => {
    const r6 = rows().get(6) ?? "";
    expect(r6).not.toBe("");
    expect(r6).not.toContain("milestone-M23");
    expect(r6).not.toContain("milestone-M46");
    expect(r6).not.toMatch(/MEASURED/);
  });

  test("a row states that the old project is never archived or deleted", () => {
    const hit = [...rows().values()].some((r) =>
      /old project[\s\S]{0,160}(never|must not)[\s\S]{0,60}archiv[\s\S]{0,60}delet/i.test(r),
    );
    expect(hit).toBe(true);
  });

  test("(control) the STE-581 pinned row phrases still match (the collision row keeps its name)", () => {
    const body = section0c();
    expect(body).toMatch(/milestone[- ]label[\s\S]{0,80}collision|collision[\s\S]{0,80}milestone[- ]label/i);
    expect(body).toMatch(/reconcil[\s\S]{0,120}(site|MCP)/i);
    expect(body).toMatch(/repo tag[\s\S]{0,160}particip/i);
  });
});

describe("AC-STE-612.9 — skills/setup/SKILL.md line 37 names the command in place", () => {
  const lines = () => read(SETUP_SKILL).split("\n");

  test("line 37 names the repoint command", () => {
    expect(lines()[36]).toContain(COMMAND);
  });

  test("(control) line 37 is still the § 0c routing line", () => {
    expect(lines()[36]).toContain("--resume-tracker-binding");
    expect(lines()[36]).toContain("§ 0c");
  });

  test("(control) 358 split-lines", () => {
    expect(lines().length).toBe(358);
  });

  test("(control) 17 STE tokens in skills/setup/SKILL.md", () => {
    expect(read(SETUP_SKILL).match(STE_TOKEN_RE)?.length ?? 0).toBe(17);
  });

  test("(control) zero new STE tokens across skills/ (245, measured at HEAD 1332279f)", () => {
    const count = (dir: string): number => {
      let total = 0;
      for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) total += count(p);
        else if (entry.endsWith(".md")) total += (readFileSync(p, "utf-8").match(STE_TOKEN_RE) ?? []).length;
      }
      return total;
    };
    expect(count(join(PLUGIN_ROOT, "skills"))).toBe(245);
  });
});
