// STE-784 (M_870603) — the trend and its upgrade step read their inputs honestly.
//
// Modules under test:
//   adapters/_shared/src/retro_trend.ts                          — buildTrendReport via `retro.ts --trend` (AC-.1..AC-.6)
//   adapters/_shared/src/migrations/entries/retro_priority_default.ts — the upgrade step (AC-.7)
//   docs/retro-reference.md                                      — the waste note (AC-.1)
//
// Each fixture is a temp git checkout outside the repo. Run i is the archived FR
// STE-(9001 + i), delivered by one `Refs:` commit on day 2i that creates
// `src/<id>.txt`, with token-ledger rows claimed by its id in session sid(i + 1).
// A run marked `shared` also claims a row in SHARED_SESSION, the one session
// several runs share. All ids are synthetic.
//
// AC-STE-784.8 is the full-suite gate the orchestrator runs; no test here.

import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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

const MIGRATIONS_MOD = join(PLUGIN_ROOT, "adapters", "_shared", "src", "migrations", "index.ts");
const RETRO_REFERENCE = join(PLUGIN_ROOT, "docs", "retro-reference.md");
const SKIPPED_PREFIX = "skipped: not observable";
const LONG = 120_000;
const SHARED_SESSION = sid(99);

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

type TrackingKey = "token_stats" | "gate_outcomes" | "tool_calls" | "review_findings";
type Tracking = Record<TrackingKey, boolean>;
const ALL_ON: Tracking = { token_stats: true, gate_outcomes: true, tool_calls: true, review_findings: true };

type G = [outcome: "P" | "F", wall: number];

interface Receipt {
  reviewer: "spec-review" | "code-review" | "tdd-audit";
  frs: string[];
  counts: unknown;
}

interface RunDef {
  skill?: "implement" | "deliver";
  lines: number;
  tokens?: number;
  gates?: G[];
  /** TDD rounds: [skill, tree_changed]. */
  rounds?: [string, boolean | null][];
  receipts?: (id: string) => Receipt[];
  /** The run also claims a ledger row in SHARED_SESSION. */
  shared?: boolean;
}

type Op = { kind: "write"; file: string; lines: number } | { kind: "append"; file: string } | { kind: "mv"; from: string; to: string };
interface Ev {
  when: string;
  op: Op;
  message: string;
}

interface Fixture {
  tracking?: Tracking;
  priority?: string[];
  runs: RunDef[];
  /** Files committed in the setup commit (no Refs: footer). */
  setupFiles?: Record<string, string>;
  events?: Ev[];
  shared?: { gates?: G[]; receipts?: Receipt[] };
}

const BASE = Date.parse("2026-09-01T10:00:00.000Z");
const DAY = 86_400_000;
const at = (days: number, hours = 0): string => new Date(BASE + days * DAY + hours * 3_600_000).toISOString();
const idOf = (i: number): string => `STE-${9001 + i}`;
const IMPL = "dev-process-toolkit:tdd-implement";

function gitAt(cwd: string, when: string, ...args: string[]): string {
  const p = spawnSync("git", args, {
    cwd,
    encoding: "utf-8",
    env: { ...process.env, ...GIT_ENV, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when },
  });
  if (p.status !== 0) throw new Error(`git ${args.join(" ")}: ${p.stderr}`);
  return p.stdout ?? "";
}

function settingsYaml(t: Tracking, priority: string[] | undefined): string {
  return (
    'schema_version: 1\nmin_dpt_version: "3.0.0"\n' +
    "tracking:\n" +
    `  token_stats:\n    enabled: ${t.token_stats}\n` +
    `  gate_outcomes:\n    enabled: ${t.gate_outcomes}\n` +
    `  tool_calls:\n    enabled: ${t.tool_calls}\n` +
    `  review_findings:\n    enabled: ${t.review_findings}\n` +
    (priority === undefined ? "" : `retro:\n  priority: [${priority.join(", ")}]\n`)
  );
}

function frFile(id: string, archivedAt: string): string {
  return (
    "---\n" +
    `title: Synthetic ${id}\n` +
    "milestone: M_fixture\n" +
    "status: archived\n" +
    `archived_at: ${archivedAt}\n` +
    `tracker:\n  linear: ${id}\n` +
    "created_at: 2026-08-20T00:00:00Z\n" +
    "changelog_category: Added\n" +
    "---\n\n" +
    `# Synthetic ${id}\n`
  );
}

const linesOf = (n: number, tag: string): string => Array.from({ length: n }, (_, k) => `${tag} line ${k + 1}`).join("\n") + "\n";

let receiptSeq = 0;
function writeReviewReceipt(root: string, session: string, createdAt: string, r: Receipt): void {
  const dir = join(root, ".dpt", "ledger", "receipts", session);
  mkdirSync(dir, { recursive: true });
  const receipt = {
    v: 1,
    kind: "review-findings",
    sessionId: session,
    root,
    adapter: null,
    container: null,
    subject: r.reviewer,
    decision: "recorded",
    evidence: { reviewer: r.reviewer, head: "0".repeat(40), frs: r.frs, counts: r.counts },
    createdAt,
  };
  const name = `${createdAt.replace(/[:.]/g, "-")}-${createHash("sha256").update(`${r.reviewer}${session}${++receiptSeq}`).digest("hex").slice(0, 8)}.json`;
  writeFileSync(join(dir, name), `${JSON.stringify(receipt)}\n`);
}

const gateRows = (gs: G[]) =>
  gs.map(([o, wall]) => gateRun(wall, { subject: GC, outcome: o === "P" ? "pass" : "fail", key_digest: KEY_A, key_stable: true }));

function buildFixture(label: string, f: Fixture): string {
  const tracking = f.tracking ?? ALL_ON;
  const root = join(tempDir(`ste784-${label}`), "repo");
  mkdirSync(root, { recursive: true });
  gitAt(root, at(-2), "init", "-q", "-b", BRANCH);
  writeFileSync(join(root, "CLAUDE.md"), SETUP_MD);
  writeFileSync(join(root, "package.json"), '{"name":"fixture","version":"0.0.0","private":true}\n');
  mkdirSync(join(root, "specs", "frs", "archive"), { recursive: true });
  writeFileSync(join(root, "specs", "settings.yaml"), settingsYaml(tracking, f.priority));
  mkdirSync(join(root, ".dpt"), { recursive: true });
  writeFileSync(join(root, ".dpt", ".gitignore"), "ledger/\nscratch/\n");
  mkdirSync(join(root, "src"), { recursive: true });
  for (const [rel, body] of Object.entries(f.setupFiles ?? {})) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  f.runs.forEach((_, i) => {
    const id = idOf(i);
    writeFileSync(join(root, "specs", "frs", "archive", `${id}.md`), frFile(id, at(2 * i + 1).replace(/\.000Z$/, "Z")));
  });
  gitAt(root, at(-1), "add", "-A");
  gitAt(root, at(-1), "commit", "-q", "-m", "chore: fixture setup");

  const events: Ev[] = f.runs.map((r, i) => ({
    when: at(2 * i),
    op: { kind: "write", file: join("src", `${idOf(i)}.txt`), lines: r.lines },
    message: `feat(core): deliver ${idOf(i)}\n\nRefs: ${idOf(i)}\n`,
  }));
  events.push(...(f.events ?? []));
  events.sort((x, y) => Date.parse(x.when) - Date.parse(y.when));
  const msgFile = join(root, "..", "msg.txt");
  for (const e of events) {
    if (e.op.kind === "write") writeFileSync(join(root, e.op.file), linesOf(e.op.lines, e.op.file));
    else if (e.op.kind === "append") appendFileSync(join(root, e.op.file), `touched at ${e.when}\n`);
    else gitAt(root, e.when, "mv", e.op.from, e.op.to);
    gitAt(root, e.when, "add", "-A");
    writeFileSync(msgFile, e.message);
    gitAt(root, e.when, "commit", "-q", "-F", msgFile);
  }

  const rows: unknown[] = [];
  f.runs.forEach((r, i) => {
    const id = idOf(i);
    const s = sid(i + 1);
    const skill = r.skill ?? "implement";
    rows.push(tokenRow(s, r.tokens ?? 100, { skill, claimed_by: id }));
    if (r.shared) rows.push(tokenRow(SHARED_SESSION, 0, { skill, claimed_by: id }));
    if (r.gates !== undefined || r.rounds !== undefined) {
      writeTimeline(root, s, timeline({ gate_runs: gateRows(r.gates ?? []), rounds: (r.rounds ?? []).map(([k, c]) => round(k, c)) }));
    }
    (r.receipts?.(id) ?? []).forEach((rc, k) => writeReviewReceipt(root, s, at(2 * i + 1, k + 1), rc));
  });
  if (f.shared?.gates !== undefined) writeTimeline(root, SHARED_SESSION, timeline({ gate_runs: gateRows(f.shared.gates) }));
  (f.shared?.receipts ?? []).forEach((rc, k) => writeReviewReceipt(root, SHARED_SESSION, at(30, k + 1), rc));
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

function group(report: any, skill: string): any {
  const g = (report.groups as any[]).find((x) => x.skill === skill);
  if (g === undefined) throw new Error(`no group for skill ${skill}: ${JSON.stringify(report.groups)}`);
  return g;
}
function metric(g: any, id: string): any {
  const m = (g.metrics as any[]).find((x) => x.id === id);
  if (m === undefined) throw new Error(`no metric ${id}: ${JSON.stringify(g.metrics)}`);
  return m;
}
function signal(g: any, id: string): any {
  const s = (g.signals as any[]).find((x) => x.id === id);
  if (s === undefined) throw new Error(`no signal ${id}: ${JSON.stringify(g.signals)}`);
  return s;
}

/** Five plain implement runs of 20 lines each. */
const fiveRuns = (extra: Partial<RunDef> = {}): RunDef[] => Array.from({ length: 5 }, () => ({ lines: 20, ...extra }));

// ===========================================================================
// AC-STE-784.1 — ties on a null delta fall through to the next ranked metric
// ===========================================================================

// Group implement: tokens per line [5,5,5,5,5] -> delta 0.
// Group deliver:   tokens per line [5,5,10,30,30] -> delta 25 (worse).
// No timelines anywhere, so waste and time are null in both groups. The
// implement runs are the lower ids, so they are read (and grouped) first.
const sortRuns = (): RunDef[] => [
  ...[100, 100, 100, 100, 100].map((t) => ({ skill: "implement" as const, lines: 20, tokens: t })),
  ...[100, 100, 200, 600, 600].map((t) => ({ skill: "deliver" as const, lines: 20, tokens: t })),
];

describe("AC-STE-784.1 groups sort worst first, falling through null deltas", () => {
  test(
    "AC-STE-784.1 waste null in both groups: tokens decides, deliver (delta 25) sorts before implement (delta 0)",
    () => {
      const r = trend("sort-default", { runs: sortRuns() });
      // Preconditions the fixture controls: the first-ranked metric is null for both.
      expect(metric(group(r, "implement"), "waste").delta).toBeNull();
      expect(metric(group(r, "deliver"), "waste").delta).toBeNull();
      expect((r.groups as any[]).map((g) => g.skill)).toEqual(["deliver", "implement"]);
    },
    LONG,
  );

  test(
    "AC-STE-784.1 priority [waste, time, tokens], waste and time null in both: tokens decides, deliver first",
    () => {
      const r = trend("sort-third", { runs: sortRuns(), priority: ["waste", "time", "tokens"] });
      expect(metric(group(r, "deliver"), "time").delta).toBeNull();
      expect(metric(group(r, "implement"), "time").delta).toBeNull();
      expect((r.groups as any[]).map((g) => g.skill)).toEqual(["deliver", "implement"]);
    },
    LONG,
  );

  test("AC-STE-784.1 docs/retro-reference.md says waste reads skipped until TDD rounds record whether they changed a file", () => {
    const doc = readFileSync(RETRO_REFERENCE, "utf-8");
    const hit = doc
      .split("\n")
      .find((l) => /waste/.test(l) && /skipped/.test(l) && /\buntil\b/.test(l) && /record/.test(l) && /chang/.test(l) && /round/.test(l));
    expect(hit).toBeString();
  });
});

// ===========================================================================
// AC-STE-784.2 — no receipt of a kind reads skipped, never 0
// ===========================================================================

describe("AC-STE-784.2 an absent review kind reads skipped: not observable", () => {
  test(
    "AC-STE-784.2 no spec-review receipt in the window: spec_review_gaps_per_fr reads skipped, not 0",
    () => {
      const r = trend("no-spec-review", {
        runs: fiveRuns({
          receipts: (id) => [
            { reviewer: "code-review", frs: [id], counts: { concerns: 1 } },
            { reviewer: "tdd-audit", frs: [id], counts: { [id]: { partial: 2, missing: 1 } } },
          ],
        }),
      });
      const g = group(r, "implement");
      const s = signal(g, "spec_review_gaps_per_fr");
      expect(s.value).toBeNull();
      expect(String(s.note)).toStartWith(SKIPPED_PREFIX);
      expect(String(s.note)).not.toContain("is off");
    },
    LONG,
  );

  test(
    "AC-STE-784.2 no code-review receipt in the window: code_review_concerns_per_100_lines reads skipped, not 0",
    () => {
      const r = trend("no-code-review", {
        runs: fiveRuns({ receipts: (id) => [{ reviewer: "spec-review", frs: [id], counts: { [id]: { done: 3, partial: 1, missing: 0 } } }] }),
      });
      const g = group(r, "implement");
      const s = signal(g, "code_review_concerns_per_100_lines");
      expect(s.value).toBeNull();
      expect(String(s.note)).toStartWith(SKIPPED_PREFIX);
      expect(String(s.note)).not.toContain("is off");
    },
    LONG,
  );

  test(
    "AC-STE-784.2 control: with spec-review receipts present, gaps read their number (5 partial over 5 FRs = 1)",
    () => {
      const r = trend("spec-review-present", {
        runs: fiveRuns({ receipts: (id) => [{ reviewer: "spec-review", frs: [id], counts: { [id]: { done: 3, partial: 1, missing: 0 } } }] }),
      });
      const s = signal(group(r, "implement"), "spec_review_gaps_per_fr");
      expect(s.note).toBeNull();
      expect(s.value).toBeCloseTo(1, 9);
    },
    LONG,
  );
});

// ===========================================================================
// AC-STE-784.3 — a shared session and its receipts count once per window
// ===========================================================================

// Five runs, 96 changed lines in all, every run also claiming SHARED_SESSION.
// Each run's own session records one passed gate run; the shared session
// records one failed gate run and one code-review receipt of 2 concerns.
const sharedRuns = (): RunDef[] => [20, 20, 20, 20, 16].map((n) => ({ lines: n, gates: [["P", 100]] as G[], shared: true }));

describe("AC-STE-784.3 a session several runs share counts once", () => {
  test(
    "AC-STE-784.3 one code-review receipt (no FR named) of 2 concerns over 96 lines reads 2.08, not 10.42",
    () => {
      const r = trend("shared-cr-empty", {
        runs: sharedRuns(),
        shared: { gates: [["F", 100]], receipts: [{ reviewer: "code-review", frs: [], counts: { concerns: 2 } }] },
      });
      const s = signal(group(r, "implement"), "code_review_concerns_per_100_lines");
      expect(s.note).toBeNull();
      expect(s.value).toBeCloseTo(200 / 96, 6);
    },
    LONG,
  );

  test(
    "AC-STE-784.3 one code-review receipt naming all five FRs still counts once: 2.08",
    () => {
      const ids = [0, 1, 2, 3, 4].map(idOf);
      const r = trend("shared-cr-all", {
        runs: sharedRuns(),
        shared: { gates: [["F", 100]], receipts: [{ reviewer: "code-review", frs: ids, counts: { concerns: 2 } }] },
      });
      const s = signal(group(r, "implement"), "code_review_concerns_per_100_lines");
      expect(s.note).toBeNull();
      expect(s.value).toBeCloseTo(200 / 96, 6);
    },
    LONG,
  );

  test(
    "AC-STE-784.3 the shared session's one failed gate run counts once: 1 fail over 6 outcomes",
    () => {
      const r = trend("shared-gates", {
        runs: sharedRuns(),
        shared: { gates: [["F", 100]], receipts: [{ reviewer: "code-review", frs: [], counts: { concerns: 2 } }] },
      });
      const s = signal(group(r, "implement"), "gate_failure_rate");
      expect(s.note).toBeNull();
      expect(s.value).toBeCloseTo(1 / 6, 9);
    },
    LONG,
  );
});

// ===========================================================================
// AC-STE-784.4 — time and gate_failure_rate need gate_outcomes AND tool_calls
// ===========================================================================

// Timelines are written whatever the switches say, so the switch alone decides.
const gatedRuns = (): RunDef[] => fiveRuns({ gates: [["P", 100], ["F", 100]], rounds: [[IMPL, true]] });

describe("AC-STE-784.4 time and gate_failure_rate name every tracking key that is off", () => {
  const cases: [string, Tracking, string[], string[]][] = [
    ["tool_calls off", { ...ALL_ON, tool_calls: false }, ["tracking.tool_calls"], ["tracking.gate_outcomes"]],
    ["gate_outcomes off", { ...ALL_ON, gate_outcomes: false }, ["tracking.gate_outcomes"], ["tracking.tool_calls"]],
    ["both off", { ...ALL_ON, gate_outcomes: false, tool_calls: false }, ["tracking.gate_outcomes", "tracking.tool_calls"], []],
  ];
  for (const [label, tracking, named, unnamed] of cases) {
    test(
      `AC-STE-784.4 ${label}: time reads skipped and names ${named.join(" and ")}`,
      () => {
        const m = metric(group(trend(`time-${label.replace(/\W+/g, "_")}`, { runs: gatedRuns(), tracking }), "implement"), "time");
        expect({ median: m.median, delta: m.delta }).toEqual({ median: null, delta: null });
        expect(String(m.note)).toStartWith(SKIPPED_PREFIX);
        for (const k of named) expect(String(m.note)).toContain(k);
        for (const k of unnamed) expect(String(m.note)).not.toContain(k);
      },
      LONG,
    );

    test(
      `AC-STE-784.4 ${label}: gate_failure_rate reads skipped and names ${named.join(" and ")}`,
      () => {
        const s = signal(group(trend(`rate-${label.replace(/\W+/g, "_")}`, { runs: gatedRuns(), tracking }), "implement"), "gate_failure_rate");
        expect(s.value).toBeNull();
        expect(String(s.note)).toStartWith(SKIPPED_PREFIX);
        for (const k of named) expect(String(s.note)).toContain(k);
        for (const k of unnamed) expect(String(s.note)).not.toContain(k);
      },
      LONG,
    );
  }
});

// ===========================================================================
// AC-STE-784.5 — a fix citing AC-<FR id>.<n> names that FR
// ===========================================================================

const fixOn = (day: number, file: string, message: string): Ev => ({ when: at(day, 3), op: { kind: "append", file }, message });
const run0File = join("src", `${idOf(0)}.txt`);

describe("AC-STE-784.5 a fix citing an AC of the FR is not a post-merge fix of it", () => {
  test(
    "AC-STE-784.5 a fix citing AC-STE-9001.2 on the FR's file is not counted (0)",
    () => {
      const r = trend("ac-cite", { runs: fiveRuns(), events: [fixOn(2, run0File, `fix(core): cover AC-${idOf(0)}.2 edge\n`)] });
      expect(signal(group(r, "implement"), "post_merge_fixes")).toMatchObject({ value: 0, note: null });
    },
    LONG,
  );

  test(
    "AC-STE-784.5 beside a plain fix (counted), the AC-citing fix is not counted (1)",
    () => {
      const r = trend("ac-cite-plus-plain", {
        runs: fiveRuns(),
        events: [fixOn(2, run0File, "fix(core): plain follow-up\n"), fixOn(3, run0File, `fix: AC-${idOf(0)}.1 regression\n`)],
      });
      expect(signal(group(r, "implement"), "post_merge_fixes")).toMatchObject({ value: 1, note: null });
    },
    LONG,
  );

  test(
    "AC-STE-784.5 a fix citing an AC of a longer id (AC-STE-90011.1) does not name STE-9001, so it counts (1)",
    () => {
      const r = trend("ac-cite-longer", { runs: fiveRuns(), events: [fixOn(2, run0File, `fix: AC-${idOf(0)}1.1 is a different FR\n`)] });
      expect(signal(group(r, "implement"), "post_merge_fixes")).toMatchObject({ value: 1, note: null });
    },
    LONG,
  );
});

// ===========================================================================
// AC-STE-784.6 — a rename in a Refs: commit records the new and the old path
// ===========================================================================

// Both files exist from the setup commit (no Refs:), so the run reaches them
// only through its rename commit on day 1: `src/{legacy-a.txt => moved-a.txt}`
// (brace form) and `legacy-b.txt => moved-b.txt` (arrow form).
const renameFixture = (fix: Ev): Fixture => ({
  runs: fiveRuns(),
  setupFiles: { "src/legacy-a.txt": linesOf(3, "legacy a"), "legacy-b.txt": linesOf(3, "legacy b") },
  events: [
    { when: at(1), op: { kind: "mv", from: "src/legacy-a.txt", to: "src/moved-a.txt" }, message: `refactor: rename for ${idOf(0)}\n\nRefs: ${idOf(0)}\n` },
    { when: at(1, 1), op: { kind: "mv", from: "legacy-b.txt", to: "moved-b.txt" }, message: `refactor: rename again for ${idOf(0)}\n\nRefs: ${idOf(0)}\n` },
    fix,
  ],
});
const writeFix = (file: string): Ev => ({ when: at(4), op: { kind: "write", file, lines: 2 }, message: "fix(core): touch a renamed path\n" });

describe("AC-STE-784.6 a renamed path is matched by its new and its old name", () => {
  for (const [label, file] of [
    ["brace rename, the new path", "src/moved-a.txt"],
    ["brace rename, the old path", "src/legacy-a.txt"],
    ["arrow rename, the new path", "moved-b.txt"],
    ["arrow rename, the old path", "legacy-b.txt"],
  ] as const) {
    test(
      `AC-STE-784.6 ${label}: a later fix touching ${file} is counted (1)`,
      () => {
        const r = trend(`rename-${label.replace(/\W+/g, "_")}`, renameFixture(writeFix(file)));
        expect(signal(group(r, "implement"), "post_merge_fixes")).toMatchObject({ value: 1, note: null });
      },
      LONG,
    );
  }
});

// ===========================================================================
// AC-STE-784.7 — retro-priority-default refuses a broken present priority
// ===========================================================================

const SETTINGS_HEAD = 'schema_version: 1\nmin_dpt_version: "3.0.0"\n';

async function migrationEntry(): Promise<any> {
  const reg = await import(MIGRATIONS_MOD);
  const entry = (reg.MIGRATIONS as any[]).find((e) => e.id === "retro-priority-default");
  if (entry === undefined) throw new Error('migration registry holds no entry "retro-priority-default"');
  return entry;
}

function settingsTree(label: string, body: string): string {
  const root = tempDir(`ste784-mig-${label}`);
  writeFileSync(join(root, "CLAUDE.md"), SETUP_MD);
  mkdirSync(join(root, "specs"), { recursive: true });
  writeFileSync(join(root, "specs", "settings.yaml"), body);
  return root;
}
const bytes = (root: string): string => readFileSync(join(root, "specs", "settings.yaml"), "utf8");

describe("AC-STE-784.7 retro-priority-default reports a broken retro.priority", () => {
  for (const [label, body] of [
    ["a null priority", `${SETTINGS_HEAD}retro:\n  enabled: true\n  priority:\n`],
    ["a priority the loader refuses", `${SETTINGS_HEAD}retro:\n  priority: [waste, waste, time]\n`],
  ] as const) {
    test(`AC-STE-784.7 ${label}: detect applies with evidence naming specs/settings.yaml`, async () => {
      const entry = await migrationEntry();
      const root = settingsTree(`detect-${label.replace(/\W+/g, "_")}`, body);
      const d = entry.detect(root);
      expect(d.applies).toBe(true);
      expect((d.evidence as string[]).join("\n")).toContain("specs/settings.yaml");
      expect(bytes(root)).toBe(body);
    });

    test(`AC-STE-784.7 ${label}: apply returns a Refusing: summary and writes nothing`, async () => {
      const entry = await migrationEntry();
      const root = settingsTree(`apply-${label.replace(/\W+/g, "_")}`, body);
      const res = entry.apply(root);
      expect(res.summary).toMatch(/^Refusing: /);
      expect(res.changed).toEqual([]);
      expect(bytes(root)).toBe(body);
    });
  }

  test("AC-STE-784.7 a throw from the settings writer becomes a Refusing: summary with the file unchanged", async () => {
    const entry = await migrationEntry();
    // A quoted `"retro":` key: the in-place writer refuses (throws) this update.
    const body = `${SETTINGS_HEAD}"retro":\n  enabled: true\n`;
    const root = settingsTree("writer-throws", body);
    expect(entry.detect(root).applies).toBe(true);
    let res: any;
    let thrown: unknown = null;
    try {
      res = entry.apply(root);
    } catch (e) {
      thrown = e;
    }
    expect(thrown === null ? null : String((thrown as Error).message).split("\n")[0]).toBeNull();
    expect(res.summary).toMatch(/^Refusing: /);
    expect(res.changed).toEqual([]);
    expect(bytes(root)).toBe(body);
  });
});
