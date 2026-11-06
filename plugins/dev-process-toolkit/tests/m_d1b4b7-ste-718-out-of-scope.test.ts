// STE-718 (M_d1b4b7) — the out-of-scope list stops ruling out what the toolkit ships.
//
// Grades `specs/requirements.md` § 5, sliced from `## 5. Out of Scope` to the
// line before the `**Tracker-integration out-of-scope:**` sub-heading, so the
// sub-lists are never graded here.
//
// Every "unchanged" line is pinned as a literal below (AC-STE-718.5), never by
// reading `main` or any other ref. The one git read in this file is AC-STE-718.8's
// byte-for-byte check of the archived STE-716 FR against the M_7bc805 merge
// commit, which that AC names as its baseline.

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runNestedBunTest } from "./_nested_bun_test";

const PLUGIN_ROOT = resolve(import.meta.dir, "..");
const REPO_ROOT = resolve(PLUGIN_ROOT, "..", "..");
const REQUIREMENTS = join(REPO_ROOT, "specs", "requirements.md");
/** The M_7bc805 merge commit: AC-STE-718.8's baseline for the archived STE-716 FR. */
const M_7BC805_MERGE = "effc0981";

const HEADING = "## 5. Out of Scope";
const SUBHEADING = "**Tracker-integration out-of-scope:**";

// ---------------------------------------------------------------- the three edited lines

const TRUNK_SLASH = "- No new slash commands (depth over breadth)";
const TRUNK_FAST = "- No fast-track workflow skipping ceremony";
const TRUNK_MULTI = "- No multi-agent orchestration";

const NEW_SLASH =
  "- ~~No new slash commands (depth over breadth)~~ — superseded in v3.2.0 (M_d1b4b7, 2026-11-04 ruling): /retro (STE-719) ships as the 20th user-invocable command. Any later command needs its own note here.";
const NEW_FAST =
  "- No fast-track workflow skipping ceremony — still in force (v3.2.0, M_d1b4b7): /retro reads the record and changes a setting only on explicit approval (STE-728), and M_fd9a03 reuse, only when its knob is on, shortens a gate run that really happens; neither skips a gate, a review or an approval.";
const NEW_MULTI =
  "- ~~No multi-agent orchestration~~ — superseded in v3.2.0 (M_d1b4b7): /tdd forks four subagents (STE-225) and /deliver drives spawned workers (STE-464); /retro grades only what their parent session can see.";

// ---------------------------------------------------------------- the eight unchanged lines (literals)

const HOOKS_LINE =
  "- ~~No hooks/bin/.lsp.json in the plugin~~ — superseded in v3.1.0: hooks ship in hooks/hooks.json since STE-289, and v3.1.0 adds an opt-in tool-call capture hook that only an approved settings change registers. bin/ and .lsp.json stay out of scope.";

const UNCHANGED: readonly string[] = [
  HOOKS_LINE,
  "- No mutation testing gate",
  "- No legacy code support (/ingest, /map)",
  "- No actual CI pipeline implementation (only starter configs as example files)",
  '- Atomic records + generated views architecture (the "Approach 4" from brainstorm) — deferred as possible v2',
  "- Automatic archival of `technical-spec.md` content — explicitly rejected; ADRs stay in place with `Superseded-by` per convention",
  "- Content-hash verification of archived blocks — nice-to-have, not required for correctness in v1.10.0",
  "- Migration tooling to convert pre-FR-18 specs (missing anchor IDs) to the new format — out of scope; `/setup` doctor validation warns, user fixes manually",
];

/** The whole slice as it must read after STE-718. */
const EXPECTED_SLICE: readonly string[] = [
  HEADING,
  "",
  NEW_SLASH,
  NEW_FAST,
  UNCHANGED[0]!,
  NEW_MULTI,
  ...UNCHANGED.slice(1),
  "",
];

// ---------------------------------------------------------------- slicing + grading

/** § 5 from its heading to the line before the tracker-integration sub-heading. */
function sliceSectionFive(text: string): string[] {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l === HEADING);
  if (start < 0) throw new Error(`no '${HEADING}' heading`);
  const end = lines.findIndex((l, i) => i > start && l === SUBHEADING);
  if (end < 0) throw new Error(`no '${SUBHEADING}' sub-heading after § 5`);
  return lines.slice(start, end);
}

const isList = (l: string): boolean => l.startsWith("- ");
const struckLine = (lines: readonly string[], wording: string): string | undefined =>
  lines.find((l) => l.startsWith(`- ~~${wording}~~`));
const noteAfterStrike = (line: string): string => line.slice(line.indexOf("~~", 4) + 2);

type Grader = (lines: readonly string[]) => string[];

/** AC-STE-718.1 — the two superseded lines struck, notes naming v3.2.0 and M_d1b4b7. */
const gradeStrikes: Grader = (lines) => {
  const out: string[] = [];
  for (const wording of ["No new slash commands (depth over breadth)", "No multi-agent orchestration"]) {
    const line = struckLine(lines, wording);
    if (!line) {
      out.push(`'${wording}' is not struck inside ~~ markers`);
      continue;
    }
    const note = noteAfterStrike(line);
    if (!note.includes("v3.2.0")) out.push(`'${wording}' note does not name v3.2.0`);
    if (!note.includes("M_d1b4b7")) out.push(`'${wording}' note does not name M_d1b4b7`);
  }
  return out;
};

/** AC-STE-718.2 — the citations each note carries. */
const gradeCitations: Grader = (lines) => {
  const out: string[] = [];
  const slash = struckLine(lines, "No new slash commands (depth over breadth)");
  const multi = struckLine(lines, "No multi-agent orchestration");
  const slashNote = slash ? noteAfterStrike(slash) : "";
  const multiNote = multi ? noteAfterStrike(multi) : "";
  if (!slashNote.includes("/retro")) out.push("new-slash-command note does not name /retro");
  if (!slashNote.includes("STE-719")) out.push("new-slash-command note does not name STE-719");
  if (!multiNote.includes("STE-225")) out.push("multi-agent note does not name STE-225");
  if (!multiNote.includes("STE-464")) out.push("multi-agent note does not name STE-464");
  return out;
};

/** AC-STE-718.3 — the fast-track line stays unstruck, its note names a gate and STE-728. */
const gradeFastTrack: Grader = (lines) => {
  const out: string[] = [];
  const hits = lines.filter((l) => l.includes("fast-track workflow"));
  if (hits.length !== 1) return [`expected exactly one fast-track line, found ${hits.length}`];
  const line = hits[0]!;
  if (line.includes("~~")) out.push("fast-track line is struck");
  if (!line.startsWith(`${TRUNK_FAST} — `)) out.push("fast-track line does not keep its wording followed by a note");
  const note = line.slice(TRUNK_FAST.length);
  if (!/\bgate\b/.test(note)) out.push("fast-track note does not say 'gate'");
  if (!note.includes("STE-728")) out.push("fast-track note does not name STE-728");
  if (!note.includes("/retro")) out.push("fast-track note does not name /retro");
  if (!note.includes("M_fd9a03")) out.push("fast-track note does not name M_fd9a03");
  if (!/neither skips a gate/.test(note)) out.push("fast-track note does not say neither skips a gate");
  return out;
};

/** AC-STE-718.4 — no bare, unstruck copy of the two superseded lines anywhere in the slice. */
const gradeNoBareCopy: Grader = (lines) => {
  const out: string[] = [];
  for (const l of lines) {
    if (l.startsWith(TRUNK_SLASH) || (l.includes("No new slash commands") && !l.includes("~~No new slash commands")))
      out.push(`bare new-slash-command line: ${l}`);
    if (l.startsWith(TRUNK_MULTI) || (l.includes("No multi-agent orchestration") && !l.includes("~~No multi-agent orchestration")))
      out.push(`bare multi-agent line: ${l}`);
  }
  return out;
};

/** AC-STE-718.5 — the eight other list lines are unchanged, pinned as literals, and the slice is exactly as expected. */
const gradeRemainder: Grader = (lines) => {
  const out: string[] = [];
  for (const want of UNCHANGED) {
    const n = lines.filter((l) => l === want).length;
    if (n !== 1) out.push(`unchanged line present ${n}x: ${want}`);
  }
  const rewritten = (l: string) =>
    l.includes("No new slash commands") || l.includes("No fast-track workflow") || l.includes("No multi-agent orchestration");
  const others = lines.filter((l) => isList(l) && !rewritten(l));
  if (JSON.stringify(others) !== JSON.stringify(UNCHANGED)) out.push("the other list lines differ from the eight pinned literals");
  if (JSON.stringify(lines) !== JSON.stringify(EXPECTED_SLICE)) out.push("the slice differs from the expected slice");
  return out;
};

const GRADERS: Record<string, Grader> = {
  "AC-STE-718.1": gradeStrikes,
  "AC-STE-718.2": gradeCitations,
  "AC-STE-718.3": gradeFastTrack,
  "AC-STE-718.4": gradeNoBareCopy,
  "AC-STE-718.5": gradeRemainder,
};

const liveSlice = (): string[] => sliceSectionFive(readFileSync(REQUIREMENTS, "utf-8"));

// ---------------------------------------------------------------- AC.1 – AC.5

describe("AC-STE-718.1 the slash-command and multi-agent lines are struck with a v3.2.0 / M_d1b4b7 note", () => {
  test("the new-slash-command line is struck and its note names v3.2.0 and M_d1b4b7", () => {
    const line = struckLine(liveSlice(), "No new slash commands (depth over breadth)");
    expect(line).toBe(NEW_SLASH);
    expect(noteAfterStrike(line!)).toContain("v3.2.0");
    expect(noteAfterStrike(line!)).toContain("M_d1b4b7");
  });

  test("the multi-agent line is struck and its note names v3.2.0 and M_d1b4b7", () => {
    const line = struckLine(liveSlice(), "No multi-agent orchestration");
    expect(line).toBe(NEW_MULTI);
    expect(noteAfterStrike(line!)).toContain("v3.2.0");
    expect(noteAfterStrike(line!)).toContain("M_d1b4b7");
  });

  test("the grader reports no strike failure on the live tree", () => {
    expect(gradeStrikes(liveSlice())).toEqual([]);
  });
});

describe("AC-STE-718.2 each note carries its citations", () => {
  test("the new-slash-command note names /retro and STE-719", () => {
    const note = noteAfterStrike(struckLine(liveSlice(), "No new slash commands (depth over breadth)") ?? "~~~~");
    expect(note).toContain("/retro");
    expect(note).toContain("STE-719");
  });

  test("the multi-agent note names STE-225 and STE-464", () => {
    const note = noteAfterStrike(struckLine(liveSlice(), "No multi-agent orchestration") ?? "~~~~");
    expect(note).toContain("STE-225");
    expect(note).toContain("STE-464");
  });

  test("the grader reports no citation failure on the live tree", () => {
    expect(gradeCitations(liveSlice())).toEqual([]);
  });
});

describe("AC-STE-718.3 the fast-track line is narrowed, not struck", () => {
  test("the fast-track line reads exactly as the Requirement gives it", () => {
    const line = liveSlice().find((l) => l.includes("fast-track workflow"));
    expect(line).toBe(NEW_FAST);
  });

  test("the fast-track line is unstruck, keeps its wording, and its note says 'gate' and names STE-728", () => {
    const line = liveSlice().find((l) => l.includes("fast-track workflow"))!;
    expect(line).not.toContain("~~");
    expect(line.startsWith(TRUNK_FAST)).toBe(true);
    const note = line.slice(TRUNK_FAST.length);
    expect(note).toMatch(/\bgate\b/);
    expect(note).toContain("STE-728");
  });

  test("the grader reports no fast-track failure on the live tree", () => {
    expect(gradeFastTrack(liveSlice())).toEqual([]);
  });
});

describe("AC-STE-718.4 no bare copy of the superseded lines remains in § 5", () => {
  test("neither trunk line appears unstruck anywhere in the slice", () => {
    const lines = liveSlice();
    expect(lines).not.toContain(TRUNK_SLASH);
    expect(lines).not.toContain(TRUNK_MULTI);
    expect(gradeNoBareCopy(lines)).toEqual([]);
  });

  test("the grader catches a bare copy added anywhere in the slice (control)", () => {
    const lines = [...EXPECTED_SLICE];
    lines.splice(9, 0, TRUNK_SLASH);
    expect(gradeNoBareCopy(lines).length).toBeGreaterThan(0);
    const lines2 = [...EXPECTED_SLICE];
    lines2.splice(12, 0, TRUNK_MULTI);
    expect(gradeNoBareCopy(lines2).length).toBeGreaterThan(0);
  });
});

describe("AC-STE-718.5 every other line of the slice is unchanged", () => {
  test("the eight pinned lines each appear once, in order, and nothing else is a list line", () => {
    expect(UNCHANGED.length).toBe(8);
    expect(gradeRemainder(liveSlice())).toEqual([]);
  });

  test("the hooks line reads exactly as M_7bc805 left it", () => {
    expect(liveSlice()).toContain(HOOKS_LINE);
  });

  test("the whole slice equals the expected slice", () => {
    expect(liveSlice()).toEqual([...EXPECTED_SLICE]);
  });

  test("this file never reads main or any other ref for § 5 (literal pins only)", () => {
    const src = readFileSync(import.meta.path, "utf-8");
    const calls = [...src.matchAll(/spawnSync\("git", \[([^\]]*)\]/g)].map((m) => m[1]!);
    for (const c of calls) expect(c).not.toContain("requirements.md");
  });
});

// ---------------------------------------------------------------- AC.6 mutation controls

describe("AC-STE-718.6 reverting any one edited line turns a named test red", () => {
  const REVERTS: Array<[string, string, string]> = [
    ["new-slash-command", NEW_SLASH, TRUNK_SLASH],
    ["fast-track", NEW_FAST, TRUNK_FAST],
    ["multi-agent", NEW_MULTI, TRUNK_MULTI],
  ];

  test("the expected slice itself passes every grader (guards a vacuous control)", () => {
    for (const [ac, g] of Object.entries(GRADERS)) expect({ ac, failures: g(EXPECTED_SLICE) }).toEqual({ ac, failures: [] });
  });

  for (const [name, now, trunk] of REVERTS) {
    test(`reverting the ${name} line to its trunk wording fails at least one AC grader`, () => {
      const mutated = EXPECTED_SLICE.map((l) => (l === now ? trunk : l));
      expect(mutated).not.toEqual([...EXPECTED_SLICE]);
      const red = Object.entries(GRADERS).filter(([, g]) => g(mutated).length > 0).map(([ac]) => ac);
      expect(red.length).toBeGreaterThan(0);
    });
  }
});

// ---------------------------------------------------------------- AC.8 the M_7bc805 test and archived STE-716

const M_7BC805_TEST = join(PLUGIN_ROOT, "tests", "m_7bc805-ste-716-out-of-scope.test.ts");
const M_7BC805_FIXTURE = join(PLUGIN_ROOT, "tests", "_m_7bc805_gate_outcome_fixture.ts");
const AMEND_COMMENT =
  "// Amended by AC-STE-718.8 (M_d1b4b7): the three lines STE-718 rewrites are graded by m_d1b4b7-ste-718-out-of-scope.test.ts.";
const STE716_CLAUSE =
  "*(Amended by AC-STE-718.8 (v3.2.0): the new-slash-command, fast-track and multi-agent lines of § 5 are rewritten by STE-718 and graded there; every other line stays byte-identical to the M_7bc805 base.)*";

function gitShow(ref: string, repoRel: string): string {
  const p = spawnSync("git", ["show", `${ref}:${repoRel}`], { cwd: REPO_ROOT, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
  if (p.status !== 0) throw new Error(`git show ${ref}:${repoRel}: ${p.stderr}`);
  return p.stdout ?? "";
}

function gitCommonDir(): string {
  const p = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: REPO_ROOT, encoding: "utf-8" });
  if (p.status !== 0) throw new Error(`git rev-parse: ${p.stderr}`);
  return p.stdout.trim();
}

/**
 * Run the AC-STE-716.13 block of the live M_7bc805 test against a scratch tree
 * whose `specs/requirements.md` is `requirements`. Returns pass/fail counts.
 */
function runM7bc805Against(requirements: string): { status: number | null; pass: number; fail: number; out: string } {
  const root = mkdtempSync(join(tmpdir(), "ste718-m7bc805-"));
  try {
    const plugin = join(root, "plugins", "dev-process-toolkit");
    mkdirSync(join(plugin, "tests"), { recursive: true });
    mkdirSync(join(root, "specs"), { recursive: true });
    copyFileSync(M_7BC805_TEST, join(plugin, "tests", "m_7bc805-ste-716-out-of-scope.test.ts"));
    copyFileSync(M_7BC805_FIXTURE, join(plugin, "tests", "_m_7bc805_gate_outcome_fixture.ts"));
    symlinkSync(join(PLUGIN_ROOT, "adapters"), join(plugin, "adapters"));
    writeFileSync(join(root, "specs", "requirements.md"), requirements);
    const p = runNestedBunTest(["tests/m_7bc805-ste-716-out-of-scope.test.ts", "--test-name-pattern", "AC-STE-716.13"], {
      cwd: plugin,
      env: { ...process.env, GIT_DIR: gitCommonDir() },
      timeoutMs: 60_000,
    });
    const out = `${p.stdout}${p.stderr}`;
    const pass = Number(/(\d+) pass/.exec(out)?.[1] ?? 0);
    const fail = Number(/(\d+) fail/.exec(out)?.[1] ?? 0);
    return { status: p.exitCode, pass, fail, out };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("AC-STE-718.8 the M_7bc805 Out of Scope test is amended, and only its remainder exclusion", () => {
  test("the M_7bc805 test carries the Amended by AC-STE-718.8 comment verbatim", () => {
    expect(readFileSync(M_7BC805_TEST, "utf-8")).toContain(AMEND_COMMENT);
  });

  test("outside the remainder test, the M_7bc805 test is byte-identical to the M_7bc805 merge commit", () => {
    const before = gitShow(M_7BC805_MERGE, "plugins/dev-process-toolkit/tests/m_7bc805-ste-716-out-of-scope.test.ts");
    const after = readFileSync(M_7BC805_TEST, "utf-8");
    const marker = '  test("every other line of § 5 is byte-identical to the milestone base"';
    const cut = before.indexOf(marker);
    expect(cut).toBeGreaterThan(0);
    // Everything up to the remainder test is unedited.
    expect(after.startsWith(before.slice(0, cut))).toBe(true);
    // Everything from the end of the 716.13 describe block onward is unedited.
    const tailMarker = "\n/** The text `inserted` such that";
    const tail = before.slice(before.indexOf(tailMarker));
    expect(tail.length).toBeGreaterThan(100);
    expect(after.endsWith(tail)).toBe(true);
    // And the file did change: the remainder exclusion was edited.
    expect(after).not.toBe(before);
  });

  const live = (): string => readFileSync(REQUIREMENTS, "utf-8");

  test("the AC-STE-716.13 block passes on the M_d1b4b7 tree", () => {
    const r = runM7bc805Against(live());
    expect({ fail: r.fail, pass: r.pass, status: r.status }).toEqual({ fail: 0, pass: 4, status: 0 });
  });

  for (const [name, now, trunk] of [
    ["new-slash-command", NEW_SLASH, TRUNK_SLASH],
    ["fast-track", NEW_FAST, TRUNK_FAST],
    ["multi-agent", NEW_MULTI, TRUNK_MULTI],
  ] as const) {
    test(`restoring the ${name} line to its trunk wording leaves the AC-STE-716.13 block green`, () => {
      const text = live();
      expect(text.split("\n")).toContain(now);
      const r = runM7bc805Against(text.split("\n").map((l) => (l === now ? trunk : l)).join("\n"));
      expect({ fail: r.fail, pass: r.pass, status: r.status }).toEqual({ fail: 0, pass: 4, status: 0 });
    });
  }

  for (const line of UNCHANGED.slice(1)) {
    test(`editing a fourth line by one byte turns the AC-STE-716.13 block red: ${line.slice(0, 40)}`, () => {
      const text = live();
      const lines = text.split("\n");
      expect(lines.filter((l) => l === line).length).toBe(1);
      const r = runM7bc805Against(lines.map((l) => (l === line ? `${l}.` : l)).join("\n"));
      expect(r.fail).toBeGreaterThan(0);
      expect(r.status).not.toBe(0);
    });
  }
});

describe("AC-STE-718.8 archived STE-716 differs from the M_7bc805 merge only by the appended AC-STE-716.13 clause", () => {
  test("specs/frs/archive/STE-716.md equals its merge-commit bytes with the clause appended to the AC-STE-716.13 line", () => {
    const rel = "specs/frs/archive/STE-716.md";
    const before = gitShow(M_7BC805_MERGE, rel);
    const after = readFileSync(join(REPO_ROOT, rel), "utf-8");
    const lines = before.split("\n");
    const idx = lines.findIndex((l) => l.startsWith("- AC-STE-716.13:"));
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(lines.filter((l) => l.startsWith("- AC-STE-716.13:")).length).toBe(1);
    const expected = lines.map((l, i) => (i === idx ? `${l} ${STE716_CLAUSE}` : l)).join("\n");
    expect(after).toBe(expected);
  });
});
