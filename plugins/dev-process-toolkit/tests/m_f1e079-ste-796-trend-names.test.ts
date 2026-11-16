// STE-796 (M_f1e079) — the trend counts fixes that name the run, and skips what it cannot see.
//
// Modules under test:
//   adapters/_shared/src/retro_trend.ts — buildTrendReport via `retro.ts --trend` (AC-.1..AC-.4)
//   docs/retro-reference.md             — the post_merge_fixes rule and waste's switches (AC-.5)
//
// Each fixture is a temp git checkout outside the repo. Run i is the archived FR
// ids[i] (STE-1..STE-5 by default), delivered by one `Refs:` commit at day 2i
// that creates `src/<id>.txt`, archived (frontmatter `archived_at`) at day 2i+1
// unless the fixture says otherwise, with token-ledger rows claimed by its id in
// session sid(i + 1). Days count from 2026-09-01T10:00:00Z. All ids are synthetic.
//
// AC-STE-796.6 is the full-suite gate the orchestrator runs; no test here.

import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  BRANCH,
  GC,
  GIT_ENV,
  KEY_A,
  PLUGIN_ROOT,
  SETUP_MD,
  cleanupTemps,
  gateRun,
  reportFiles,
  retroDir,
  round,
  runRetro,
  sid,
  tempDir,
  timeline,
  tokenRow,
  writeTimeline,
  writeTokenLedger,
} from "./_m_d1b4b7_retro_fixture";

afterAll(cleanupTemps);

const RETRO_REFERENCE = join(PLUGIN_ROOT, "docs", "retro-reference.md");
const SKIPPED_PREFIX = "skipped: not observable";
const NOT_CC_NOTE = "skipped: not observable (history is not Conventional Commits)";
const LONG = 120_000;
const IMPL = "dev-process-toolkit:tdd-implement";

type TrackingKey = "token_stats" | "gate_outcomes" | "tool_calls" | "review_findings";
type Tracking = Record<TrackingKey, boolean>;
const ALL_ON: Tracking = { token_stats: true, gate_outcomes: true, tool_calls: true, review_findings: true };

type G = [outcome: "P" | "F", wall: number];

interface RunDef {
  lines: number;
  gates?: G[];
  rounds?: [string, boolean | null][];
}

type Op = { kind: "write"; file: string; lines: number } | { kind: "append"; file: string };
interface Ev {
  when: string;
  op: Op;
  message: string;
}

interface Fixture {
  tracking?: Tracking;
  runs?: RunDef[];
  /** The raw `archived_at` frontmatter value for run i; `undefined` omits the key. */
  archivedAt?: (i: number) => string | undefined;
  events?: Ev[];
}

const BASE = Date.parse("2026-09-01T10:00:00.000Z");
const DAY = 86_400_000;
const at = (days: number, hours = 0): string => new Date(BASE + days * DAY + hours * 3_600_000).toISOString();
const stamp = (days: number): string => at(days).replace(/\.000Z$/, "Z");
const idOf = (i: number): string => `STE-${i + 1}`;
const defaultArchivedAt = (i: number): string => stamp(2 * i + 1);

function gitAt(cwd: string, when: string, ...args: string[]): string {
  const p = spawnSync("git", args, {
    cwd,
    encoding: "utf-8",
    env: { ...process.env, ...GIT_ENV, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when },
  });
  if (p.status !== 0) throw new Error(`git ${args.join(" ")}: ${p.stderr}`);
  return p.stdout ?? "";
}

function settingsYaml(t: Tracking): string {
  return (
    'schema_version: 1\nmin_dpt_version: "3.0.0"\n' +
    "tracking:\n" +
    `  token_stats:\n    enabled: ${t.token_stats}\n` +
    `  gate_outcomes:\n    enabled: ${t.gate_outcomes}\n` +
    `  tool_calls:\n    enabled: ${t.tool_calls}\n` +
    `  review_findings:\n    enabled: ${t.review_findings}\n`
  );
}

function frFile(id: string, archivedAt: string | undefined): string {
  return (
    "---\n" +
    `title: Synthetic ${id}\n` +
    "milestone: M_demo\n" +
    "status: archived\n" +
    (archivedAt === undefined ? "" : `archived_at: ${archivedAt}\n`) +
    `tracker:\n  linear: ${id}\n` +
    "created_at: 2026-08-20T00:00:00Z\n" +
    "changelog_category: Added\n" +
    "---\n\n" +
    `# Synthetic ${id}\n`
  );
}

const linesOf = (n: number, tag: string): string => Array.from({ length: n }, (_, k) => `${tag} line ${k + 1}`).join("\n") + "\n";
const fiveRuns = (extra: Partial<RunDef> = {}): RunDef[] => Array.from({ length: 5 }, () => ({ lines: 20, ...extra }));

function buildFixture(label: string, f: Fixture): string {
  const tracking = f.tracking ?? ALL_ON;
  const runs = f.runs ?? fiveRuns();
  const archivedAt = f.archivedAt ?? defaultArchivedAt;
  const root = join(tempDir(`ste796-${label}`), "repo");
  mkdirSync(root, { recursive: true });
  gitAt(root, at(-2), "init", "-q", "-b", BRANCH);
  writeFileSync(join(root, "CLAUDE.md"), SETUP_MD);
  writeFileSync(join(root, "package.json"), '{"name":"fixture","version":"0.0.0","private":true}\n');
  mkdirSync(join(root, "specs", "frs", "archive"), { recursive: true });
  writeFileSync(join(root, "specs", "settings.yaml"), settingsYaml(tracking));
  mkdirSync(join(root, ".dpt"), { recursive: true });
  writeFileSync(join(root, ".dpt", ".gitignore"), "ledger/\nscratch/\n");
  mkdirSync(join(root, "src"), { recursive: true });
  runs.forEach((_, i) => {
    const id = idOf(i);
    writeFileSync(join(root, "specs", "frs", "archive", `${id}.md`), frFile(id, archivedAt(i)));
  });
  gitAt(root, at(-1), "add", "-A");
  gitAt(root, at(-1), "commit", "-q", "-m", "chore: fixture setup");

  const events: Ev[] = runs.map((r, i) => ({
    when: at(2 * i),
    op: { kind: "write", file: join("src", `${idOf(i)}.txt`), lines: r.lines },
    message: `feat(core): deliver ${idOf(i)}\n\nRefs: ${idOf(i)}\n`,
  }));
  events.push(...(f.events ?? []));
  events.sort((x, y) => Date.parse(x.when) - Date.parse(y.when));
  const msgFile = join(root, "..", "msg.txt");
  for (const e of events) {
    if (e.op.kind === "write") writeFileSync(join(root, e.op.file), linesOf(e.op.lines, `${e.op.file} ${e.when}`));
    else appendFileSync(join(root, e.op.file), `touched at ${e.when}\n`);
    gitAt(root, e.when, "add", "-A");
    writeFileSync(msgFile, e.message);
    gitAt(root, e.when, "commit", "-q", "-F", msgFile);
  }

  const rows: unknown[] = [];
  runs.forEach((r, i) => {
    const s = sid(i + 1);
    rows.push(tokenRow(s, 100, { skill: "implement", claimed_by: idOf(i) }));
    if (r.gates !== undefined || r.rounds !== undefined) {
      const gate_runs = (r.gates ?? []).map(([o, wall]) =>
        gateRun(wall, { subject: GC, outcome: o === "P" ? "pass" : "fail", key_digest: KEY_A, key_stable: true }),
      );
      writeTimeline(root, s, timeline({ gate_runs, rounds: (r.rounds ?? []).map(([k, c]) => round(k, c)) }));
    }
  });
  writeTokenLedger(root, rows);
  return realpathSync(root);
}

function trend(label: string, f: Fixture): any {
  const root = buildFixture(label, f);
  const r = runRetro(root, ["--trend"]);
  if (r.status !== 0) throw new Error(`retro.ts --trend exited ${r.status}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  const files = reportFiles(root).filter((n) => n.startsWith("trend-"));
  if (files.length !== 1) throw new Error(`expected one trend report, found ${JSON.stringify(reportFiles(root))}`);
  return JSON.parse(readFileSync(join(retroDir(root), files[0]!), "utf-8"));
}

function implementGroup(report: any): any {
  const g = (report.groups as any[]).find((x) => x.skill === "implement");
  if (g === undefined) throw new Error(`no implement group: ${JSON.stringify(report.groups)}`);
  if (g.runs !== 5) throw new Error(`expected 5 runs in the implement group, got ${g.runs}`);
  return g;
}
function signal(g: any, id: string): any {
  const s = (g.signals as any[]).find((x) => x.id === id);
  if (s === undefined) throw new Error(`no signal ${id}: ${JSON.stringify(g.signals)}`);
  return s;
}
function metric(g: any, id: string): any {
  const m = (g.metrics as any[]).find((x) => x.id === id);
  if (m === undefined) throw new Error(`no metric ${id}: ${JSON.stringify(g.metrics)}`);
  return m;
}

/** The group's post_merge_fixes cell as { value, note }. */
function pmf(label: string, f: Fixture): { value: unknown; note: unknown } {
  const s = signal(implementGroup(trend(label, f)), "post_merge_fixes");
  return { value: s.value, note: s.note };
}

/** A commit at `when` that writes `src/other.txt` (a file no run touched). */
const elsewhere = (when: string, message: string): Ev => ({ when, op: { kind: "write", file: join("src", "other.txt"), lines: 1 }, message });

// Run 0 is STE-1: delivered at day 0, archived at day 1.

// ===========================================================================
// AC-STE-796.1 — a fix counts when it names the run, inside 14 days after archived_at
// ===========================================================================

describe("AC-STE-796.1 post_merge_fixes counts fix commits that name the run after it was archived", () => {
  test(
    "AC-STE-796.1 a fix whose subject names STE-1, a day after archival, on an unrelated file, counts (1)",
    () => {
      expect(pmf("subject-names", { events: [elsewhere(at(2), "fix(core): close the STE-1 edge case\n")] })).toEqual({ value: 1, note: null });
    },
    LONG,
  );

  test(
    "AC-STE-796.1 a fix naming STE-1 only in its Refs: trailer counts (1)",
    () => {
      expect(pmf("refs-names", { events: [elsewhere(at(2), "fix(core): close an edge case\n\nRefs: STE-1\n")] })).toEqual({ value: 1, note: null });
    },
    LONG,
  );

  test(
    "AC-STE-796.1 fixes naming two different runs pool to 2",
    () => {
      const events = [elsewhere(at(2), "fix(core): close the STE-1 edge case\n"), elsewhere(at(6), "fix: repair STE-3 output\n")];
      expect(pmf("two-runs", { events })).toEqual({ value: 2, note: null });
    },
    LONG,
  );

  test(
    "AC-STE-796.1 a fix naming STE-1 only in its body does not count (0)",
    () => {
      expect(pmf("body-only", { events: [elsewhere(at(2), "fix(core): close an edge case\n\nFollow-up to STE-1.\n")] })).toEqual({ value: 0, note: null });
    },
    LONG,
  );

  test(
    "AC-STE-796.1 a fix naming STE-10 in subject and Refs: does not name STE-1 (0)",
    () => {
      expect(pmf("other-id", { events: [elsewhere(at(2), "fix(core): close the STE-10 edge case\n\nRefs: STE-10\n")] })).toEqual({ value: 0, note: null });
    },
    LONG,
  );

  test(
    "AC-STE-796.1 a fix touching the run's own file without naming it does not count (0)",
    () => {
      const ev: Ev = { when: at(2), op: { kind: "append", file: join("src", "STE-1.txt") }, message: "fix(core): tighten the delivery\n" };
      expect(pmf("own-file-unnamed", { events: [ev] })).toEqual({ value: 0, note: null });
    },
    LONG,
  );

  test(
    "AC-STE-796.1 a non-fix commit naming STE-1 does not count (0)",
    () => {
      expect(pmf("feat-names", { events: [elsewhere(at(2), "feat(core): extend STE-1\n")] })).toEqual({ value: 0, note: null });
    },
    LONG,
  );

  test(
    "AC-STE-796.1 a fix naming STE-1 after its delivery but before its archived_at does not count (0)",
    () => {
      expect(pmf("before-archive", { events: [elsewhere(at(0, 12), "fix(core): STE-1 pre-archive tweak\n")] })).toEqual({ value: 0, note: null });
    },
    LONG,
  );

  test(
    "AC-STE-796.1 a fix naming STE-1 13 days after archived_at counts (1)",
    () => {
      expect(pmf("plus-13d", { events: [elsewhere(at(1 + 13), "fix(core): STE-1 late follow-up\n")] })).toEqual({ value: 1, note: null });
    },
    LONG,
  );

  test(
    "AC-STE-796.1 a fix naming STE-1 exactly 14 days after archived_at counts (1)",
    () => {
      expect(pmf("plus-14d", { events: [elsewhere(at(1 + 14), "fix(core): STE-1 last-day follow-up\n")] })).toEqual({ value: 1, note: null });
    },
    LONG,
  );

  test(
    "AC-STE-796.1 a fix naming STE-1 14 days and an hour after archived_at does not count (0)",
    () => {
      expect(pmf("plus-14d-1h", { events: [elsewhere(at(1 + 14, 1), "fix(core): STE-1 too late\n")] })).toEqual({ value: 0, note: null });
    },
    LONG,
  );

  test(
    "AC-STE-796.1 the window starts at archived_at, not the last Refs: commit: a fix 21 days after delivery, a day after a late archival, counts (1)",
    () => {
      const archivedAt = (i: number) => (i === 0 ? stamp(20) : defaultArchivedAt(i));
      expect(pmf("late-archive", { archivedAt, events: [elsewhere(at(21), "fix(core): STE-1 follow-up\n")] })).toEqual({ value: 1, note: null });
    },
    LONG,
  );

  test(
    "AC-STE-796.1 a later Refs: fix does not move the window: a named fix before it still counts (2)",
    () => {
      const events = [elsewhere(at(2), "fix(core): STE-1 first follow-up\n"), elsewhere(at(4), "fix(core): second follow-up\n\nRefs: STE-1\n")];
      expect(pmf("refs-fix-later", { events })).toEqual({ value: 2, note: null });
    },
    LONG,
  );
});

// ===========================================================================
// AC-STE-796.2 — an unreadable archived_at makes the count unobservable
// ===========================================================================

describe("AC-STE-796.2 a run whose archived_at is not a date makes post_merge_fixes null", () => {
  for (const [label, raw] of [
    ["not-a-date", "not-a-date"],
    ["null", "null"],
  ] as const) {
    test(
      `AC-STE-796.2 archived_at: ${raw} on STE-3, beside a counted fix of STE-1: value null, skipped`,
      () => {
        const archivedAt = (i: number) => (i === 2 ? raw : defaultArchivedAt(i));
        const s = pmf(`bad-archived-${label}`, { archivedAt, events: [elsewhere(at(2), "fix(core): close the STE-1 edge case\n")] });
        expect(s.value).toBeNull();
        expect(String(s.note)).toStartWith(SKIPPED_PREFIX);
      },
      LONG,
    );
  }

  test(
    "AC-STE-796.2 no archived_at key on STE-3: value null, skipped",
    () => {
      const archivedAt = (i: number) => (i === 2 ? undefined : defaultArchivedAt(i));
      const s = pmf("absent-archived", { archivedAt, events: [elsewhere(at(2), "fix(core): close the STE-1 edge case\n")] });
      expect(s.value).toBeNull();
      expect(String(s.note)).toStartWith(SKIPPED_PREFIX);
    },
    LONG,
  );
});

// ===========================================================================
// AC-STE-796.3 — a history that is not Conventional Commits reads skipped
// ===========================================================================

// The delivery commits at days 2, 4, 6, 8 fall inside the windows (days 1..23)
// and are Conventional Commits; `n` plain commits are added at days 3.. hour 5.
const plainCommits = (n: number): Ev[] =>
  Array.from({ length: n }, (_, k) => ({ when: at(3 + k, 5), op: { kind: "append", file: join("src", "notes.txt") } as Op, message: `Update notes ${k + 1}\n` }));
const notesFile: Ev = { when: at(-1, 1), op: { kind: "write", file: join("src", "notes.txt"), lines: 1 }, message: "chore: add notes\n" };

describe("AC-STE-796.3 post_merge_fixes needs a Conventional Commits history", () => {
  test(
    "AC-STE-796.3 12 plain subjects against 5 Conventional ones in the windows: value null with the not-Conventional note",
    () => {
      const events = [notesFile, ...plainCommits(12), elsewhere(at(2), "fix(core): close the STE-1 edge case\n")];
      expect(pmf("not-cc", { events })).toEqual({ value: null, note: NOT_CC_NOTE });
    },
    LONG,
  );

  test(
    "AC-STE-796.3 2 plain subjects against 5 Conventional ones: observable, the named fix counts (1)",
    () => {
      const events = [notesFile, ...plainCommits(2), elsewhere(at(2), "fix(core): close the STE-1 edge case\n")];
      expect(pmf("mostly-cc", { events })).toEqual({ value: 1, note: null });
    },
    LONG,
  );

  test(
    "AC-STE-796.3 windows holding no commit at all keep an observable 0",
    () => {
      // Archived at days 30..38, long after the last commit at day 8.
      expect(pmf("empty-windows", { archivedAt: (i) => stamp(30 + 2 * i) })).toEqual({ value: 0, note: null });
    },
    LONG,
  );
});

// ===========================================================================
// AC-STE-796.4 — waste names both tracking switches it reads
// ===========================================================================

// Timelines are written whatever the switches say, so the switch alone decides.
const gatedRuns = (): RunDef[] => fiveRuns({ gates: [["P", 100], ["F", 100]], rounds: [[IMPL, true]] });

describe("AC-STE-796.4 waste reads tracking.gate_outcomes and tracking.tool_calls", () => {
  const cases: [string, Tracking, string][] = [
    ["gate_outcomes off", { ...ALL_ON, gate_outcomes: false }, "skipped: not observable (tracking.gate_outcomes is off)"],
    ["tool_calls off", { ...ALL_ON, tool_calls: false }, "skipped: not observable (tracking.tool_calls is off)"],
    ["both off", { ...ALL_ON, gate_outcomes: false, tool_calls: false }, "skipped: not observable (tracking.gate_outcomes and tracking.tool_calls are off)"],
  ];
  for (const [label, tracking, note] of cases) {
    test(
      `AC-STE-796.4 ${label}: waste reads ${JSON.stringify(note)}`,
      () => {
        const m = metric(implementGroup(trend(`waste-${label.replace(/\W+/g, "_")}`, { runs: gatedRuns(), tracking })), "waste");
        expect({ median: m.median, delta: m.delta, note: m.note }).toEqual({ median: null, delta: null, note });
      },
      LONG,
    );
  }
});

// ===========================================================================
// AC-STE-796.5 — docs/retro-reference.md describes the new rule
// ===========================================================================

describe("AC-STE-796.5 docs/retro-reference.md describes post_merge_fixes and waste's switches", () => {
  const doc = (): string => readFileSync(RETRO_REFERENCE, "utf-8");
  /** Every line's text after its first `post_merge_fixes` mention, joined. */
  const pmfText = (): string =>
    doc()
      .split("\n")
      .filter((l) => l.includes("`post_merge_fixes`"))
      .map((l) => l.slice(l.indexOf("`post_merge_fixes`")))
      .join("\n");

  test("AC-STE-796.5 post_merge_fixes is anchored on archived_at, 14 days", () => {
    const t = pmfText();
    expect(t).toContain("archived_at");
    expect(t).toContain("14 days");
  });

  test("AC-STE-796.5 post_merge_fixes names the run by its subject or its Refs: trailer", () => {
    const t = pmfText();
    expect(t).toMatch(/subject/);
    expect(t).toContain("Refs:");
  });

  test("AC-STE-796.5 post_merge_fixes no longer describes touching the run's files", () => {
    expect(pmfText()).not.toMatch(/touch(es)? a file/);
  });

  test("AC-STE-796.5 the doc carries the not-Conventional-Commits skip note", () => {
    expect(doc()).toContain(NOT_CC_NOTE);
  });

  test("AC-STE-796.5 the waste row's input lists tracking.gate_outcomes and tracking.tool_calls", () => {
    const row = doc()
      .split("\n")
      .find((l) => l.startsWith("| `waste` |"));
    expect(row).toBeString();
    const cells = row!.split("|");
    const input = cells[cells.length - 2]!;
    expect(input).toContain("`tracking.gate_outcomes`");
    expect(input).toContain("`tracking.tool_calls`");
  });
});
