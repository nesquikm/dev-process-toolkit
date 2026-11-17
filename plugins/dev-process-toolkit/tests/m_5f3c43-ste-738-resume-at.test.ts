// STE-738 (M_5f3c43) AC-STE-738.13 — /implement accepts --resume-at and passes
// it to /tdd; every surface that names the resume command names one that
// parses it. Amends AC-STE-722.8 and AC-STE-738.4 by name (their suites admit
// the three SKILL.md lines through tests/_m_5f3c43_ste738_implement_admissions.ts).
// Each test names the mutant it kills.

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { formatHaltReport } from "../adapters/_shared/src/tdd_halt_report";
import { HINT_INDEX, STEP_14_APPEND, STEP_14_INDEX, STEP_8_APPEND, STEP_8_INDEX, undoAdmissions, undoSte835, STE_835_PARAGRAPH, STE_835_POINTER } from "./_m_5f3c43_ste738_implement_admissions";

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

  // Kills: `entry: implement` passed only on a resume (the round-1 wording) — a
  // first run's halt would then name `/tdd … --resume-at`, and resuming that way
  // skips /implement's later phases.
  test("step 8 passes `entry: implement` on every run, unconditionally, and --resume-at only when given", () => {
    const sentences = STEP_8_APPEND.trim().split(/;\s+/);
    const entry = sentences.find((x) => x.includes("`entry: implement`"))!;
    expect(entry).toContain("always passes `entry: implement`");
    expect(entry).not.toContain("--resume-at");
    expect(sentences.find((x) => x.includes("--resume-at <point>` follows the FR"))).toBeDefined();
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
    expect(IMPLEMENT.split("\n")[281]!.startsWith("14. **Report**")).toBe(true); // Amended by AC-STE-835.1 (M_d1e7b1): +2 below the STE-835 paragraph.
    expect(IMPLEMENT.split("\n")[281]!.endsWith(STEP_14_APPEND)).toBe(true); // Amended by AC-STE-835.1 (M_d1e7b1): +2 below the STE-835 paragraph.
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

  // Kills: a first (non-resume) halt of an /implement-started run naming /tdd — the
  // halt reporter must honour `entry` on a first-pass halt, not only on a resume.
  test("a first-pass halt of an /implement-started run names /dev-process-toolkit:implement for the resume", () => {
    for (const r of [
      { mode: "B" as const, role: "implementer" as const, entry: "implement" as const, fr: "STE-901", ac: "AC-STE-901.1", retryCount: 2 },
      { mode: "not-load-bearing" as const, role: "implementer" as const, entry: "implement" as const, fr: "STE-901", ac: "AC-STE-901.1", retryCount: 0 },
      { mode: "C" as const, role: "refactorer" as const, entry: "implement" as const, fr: "STE-901", retryCount: 2 },
    ]) {
      const out = formatHaltReport(r);
      expect({ mode: r.mode, skills: resumeCommandSkills(out) }).toEqual({ mode: r.mode, skills: ["implement"] });
      expect(out).toContain("/dev-process-toolkit:implement STE-901 --resume-at");
    }
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
  // Amended by AC-STE-835.1 (M_d1e7b1): these admissions index the pre-STE-835 layout, so the
  // STE-835 edits are undone first; a file that does not carry them exactly once fails here.
  const s835 = undoSte835(IMPLEMENT.split("\n"));
  if ("error" in s835) throw new Error(s835.error);
  const lines = s835.lines;
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

// Amended by AC-STE-835.1 (M_d1e7b1). Kills: the STE-835 admission widened past its exact bytes and position.
describe("AC-STE-835.1 — the STE-835 admission refuses by name", () => {
  const cur = IMPLEMENT.split("\n");
  const err = (edited: string[]): string | null => {
    const r = undoSte835(edited);
    return "error" in r ? r.error : null;
  };

  test("the current file undoes cleanly", () => {
    expect(err(cur)).toBeNull();
  });

  test("an edited paragraph, a missing blank line above it, or a doubled paragraph is refused", () => {
    const at = cur.indexOf(STE_835_PARAGRAPH);
    expect(at).toBeGreaterThan(0);
    const edited = [...cur];
    edited[at] = `${edited[at]} Then also edit the FR.`;
    expect(err(edited)).toBe("the STE-835 Phase 3 paragraph is not carried exactly once, after one blank line");
    const noBlank = [...cur];
    noBlank.splice(at - 1, 1);
    expect(err(noBlank)).toBe("the STE-835 Phase 3 paragraph is not carried exactly once, after one blank line");
    const doubled = [...cur];
    doubled.splice(at + 1, 0, "", STE_835_PARAGRAPH);
    expect(err(doubled)).toBe("the STE-835 Phase 3 paragraph is not carried exactly once, after one blank line");
  });

  test("a paragraph moved out of place, or a pointer moved off the last line, is refused", () => {
    const at = cur.indexOf(STE_835_PARAGRAPH);
    const moved = [...cur];
    moved.splice(at - 1, 2);
    moved.splice(100, 0, "", STE_835_PARAGRAPH);
    expect(err(moved)).toBe(`the STE-835 Phase 3 paragraph sits at index 101, not ${at} (after step i)`);
    const p = cur.indexOf(STE_835_POINTER);
    const movedPtr = [...cur];
    movedPtr.splice(p, 1);
    movedPtr.splice(300, 0, STE_835_POINTER);
    expect(err(movedPtr)).toBe("the STE-835 Architecture Note pointer is not the file's last line");
  });

  test("a missing or doubled Architecture Note pointer is refused", () => {
    const p = cur.indexOf(STE_835_POINTER);
    expect(p).toBeGreaterThan(0);
    const gone = cur.filter((l) => l !== STE_835_POINTER);
    expect(err(gone)).toBe("the STE-835 Architecture Note pointer is not carried exactly once");
    const twice = [...cur];
    twice.splice(p, 0, STE_835_POINTER);
    expect(err(twice)).toBe("the STE-835 Architecture Note pointer is not carried exactly once");
  });
});
