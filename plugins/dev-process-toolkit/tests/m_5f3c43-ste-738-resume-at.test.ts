// STE-738 (M_5f3c43) AC-STE-738.13 — /implement accepts --resume-at and passes
// it to /tdd; every surface that names the resume command names one that
// parses it. Amends AC-STE-722.8 and AC-STE-738.4 by name (their suites admit
// the three SKILL.md lines through tests/_m_5f3c43_ste738_implement_admissions.ts).
// Each test names the mutant it kills.

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { formatHaltReport } from "../adapters/_shared/src/tdd_halt_report";
import { HINT_INDEX, STEP_14_APPEND, STEP_14_INDEX, STEP_8_APPEND, STEP_8_INDEX, undoAdmissions } from "./_m_5f3c43_ste738_implement_admissions";

const PLUGIN = join(import.meta.dir, "..");
const read = (rel: string): string => readFileSync(join(PLUGIN, rel), "utf8");
const IMPLEMENT = read("skills/implement/SKILL.md");
const REFERENCE = read("docs/implement-reference.md");

/** A skill's frontmatter argument-hint, or null. */
function argumentHint(skill: string): string | null {
  const m = /^argument-hint: (.*)$/m.exec(read(`skills/${skill}/SKILL.md`));
  return m ? m[1]! : null;
}

/** Every `/dev-process-toolkit:<skill> … --resume-at` command a text names (the short `/<skill>` form too), by skill. */
function resumeCommandSkills(text: string): string[] {
  return [...text.matchAll(/(?<![\w.:/-])\/(?:dev-process-toolkit:)?([a-z][a-z-]*) [^ `\n]+ --resume-at/g)].map((m) => m[1]!);
}

/** The text files a resume command may be named on: every SKILL.md, agent, doc and the halt reporter. */
function surfaces(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const d of readdirSync(join(PLUGIN, "skills"))) {
    try {
      out.push([`skills/${d}/SKILL.md`, read(`skills/${d}/SKILL.md`)]);
    } catch {
      // not a skill directory
    }
  }
  for (const dir of ["agents", "docs"]) {
    for (const f of readdirSync(join(PLUGIN, dir))) if (f.endsWith(".md")) out.push([`${dir}/${f}`, read(`${dir}/${f}`)]);
  }
  out.push(["adapters/_shared/src/tdd_halt_report.ts", read("adapters/_shared/src/tdd_halt_report.ts")]);
  return out;
}

describe("AC-STE-738.13 — /implement accepts --resume-at and passes it to /tdd", () => {
  // Kills: the argument-hint edit reverted (the halt report's command names a flag /implement never declares).
  test("the /implement argument-hint declares --resume-at with the three point kinds", () => {
    expect(argumentHint("implement")).toContain("[--resume-at <AC-id>|refactor|audit]");
  });

  // Kills: Phase 2 step 8 forgetting to pass the flag, or `entry: implement`, on to /tdd.
  test("Phase 2 step 8 passes --resume-at and entry: implement to /tdd, pointing at the reference section", () => {
    const step8 = IMPLEMENT.split("\n")[91]!;
    expect(step8.startsWith("   invoke `/dev-process-toolkit:tdd <FR-id>` inline")).toBe(true);
    expect(step8.endsWith(STEP_8_APPEND)).toBe(true);
    expect(STEP_8_APPEND).toContain("`/dev-process-toolkit:tdd <FR-id> --resume-at <point>`");
    expect(STEP_8_APPEND).toContain("`entry: implement`");
  });

  // Kills: a pointer to a section the reference doc does not have.
  test("both SKILL.md pointers name a section the reference doc carries", () => {
    for (const suffix of [STEP_8_APPEND, STEP_14_APPEND]) {
      const heading = /§ (.+)\.$/.exec(suffix)![1]!;
      expect({ heading, found: REFERENCE.includes(`\n## ${heading}\n`) }).toEqual({ heading, found: true });
    }
  });

  // Kills: step 14 left with no route to the e2e advisories → follow_ups rule.
  test("step 14 states each e2e advisory as a follow_ups row, and the reference section carries that rule", () => {
    expect(IMPLEMENT.split("\n")[279]!.startsWith("14. **Report**")).toBe(true);
    expect(IMPLEMENT.split("\n")[279]!.endsWith(STEP_14_APPEND)).toBe(true);
    const start = REFERENCE.indexOf("\n## Phase 4 End-to-End Authoring Hook\n");
    const next = REFERENCE.indexOf("\n## ", start + 1);
    const section = REFERENCE.slice(start, next < 0 ? undefined : next);
    expect(section).toContain("`advisories`");
    expect(section).toContain("`follow_ups`");
  });
});

describe("AC-STE-738.13 — every surface naming the resume command names one that parses it", () => {
  // Kills: a halt report (entry=implement) naming /implement while /implement cannot parse the flag.
  test("a halt report from an /implement-started run names a resume command whose skill declares --resume-at", () => {
    const out = formatHaltReport({ mode: "B", role: "implementer", entry: "implement", fr: "STE-901", ac: "AC-STE-901.3", retryCount: 2 });
    const skills = resumeCommandSkills(out);
    expect(skills).toEqual(["implement"]);
    for (const s of skills) expect({ s, hint: argumentHint(s)?.includes("--resume-at") }).toEqual({ s, hint: true });
  });

  // Kills: any doc, skill or reporter naming `/<skill> … --resume-at` for a skill whose hint lacks it.
  test("every /dev-process-toolkit:<skill> … --resume-at on a plugin surface names a skill whose argument-hint declares it", () => {
    const named: string[] = [];
    for (const [rel, text] of surfaces()) {
      for (const s of resumeCommandSkills(text)) {
        named.push(`${rel}→${s}`);
        expect({ rel, s, hint: argumentHint(s)?.includes("--resume-at") ?? false }).toEqual({ rel, s, hint: true });
      }
    }
    // The sweep is not vacuous: it reaches /tdd's own resume line and the /implement one beside it.
    expect(named).toContain("skills/tdd/SKILL.md→tdd");
    expect(named).toContain("skills/tdd/SKILL.md→implement");
    expect(named).toContain("docs/implement-reference.md→implement");
  });
});

describe("AC-STE-738.13 — the admissions refuse by name, before any hash", () => {
  const lines = IMPLEMENT.split("\n");
  const reason = (edited: string[]): string | null => {
    const r = undoAdmissions(edited);
    return "error" in r ? r.error : null;
  };

  test("the current file undoes cleanly", () => {
    expect(reason(lines)).toBeNull();
  });

  // Kills: the argument-hint guard dropped (a hint without the flag, or with it twice, sliced blindly).
  test("a hint without --resume-at, or naming it twice, is refused as line 4", () => {
    const gone = [...lines];
    gone[HINT_INDEX] = gone[HINT_INDEX]!.replace(" [--resume-at <AC-id>|refactor|audit]", "");
    expect(reason(gone)).toBe("line 4 does not carry the --resume-at argument-hint exactly once");
    const twice = [...lines];
    twice[HINT_INDEX] = twice[HINT_INDEX]!.replace("argument-hint: '", "argument-hint: '--resume-at ");
    expect(reason(twice)).toBe("line 4 does not carry the --resume-at argument-hint exactly once");
  });

  // Kills: the exactly-once half of the append guard dropped (a doubled pointer undone once).
  test("a pointer appended twice, or missing, is refused by its line", () => {
    for (const [i, suffix, name] of [
      [STEP_8_INDEX, STEP_8_APPEND, "line 92"],
      [STEP_14_INDEX, STEP_14_APPEND, "line 280"],
    ] as const) {
      const doubled = [...lines];
      doubled[i] = `${doubled[i]}${suffix}`;
      expect(reason(doubled)).toBe(`${name} does not end with its AC-STE-738.13 pointer exactly once`);
      const missing = [...lines];
      missing[i] = missing[i]!.slice(0, -suffix.length);
      expect(reason(missing)).toBe(`${name} does not end with its AC-STE-738.13 pointer exactly once`);
    }
  });
});
