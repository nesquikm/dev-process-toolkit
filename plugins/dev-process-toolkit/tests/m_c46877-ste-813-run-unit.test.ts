// STE-813 (M_c46877) — the trend reports one run per (FR, skill), with the
// settings it ran under.
//
// AC-STE-813.1  one run per (archived FR, skill); sessions, output tokens and
//               the incomplete flag from that skill's rows only; changed lines
//               shared; a two-skill FR yields two runs in two groups
// AC-STE-813.2  settings join: earliest run-start row with the run's FR and
//               skill, else earliest with one of its sessions and its skill,
//               else "settings unknown"; a pre-release ledger is all unknown
// AC-STE-813.3  group `runs_detail` (window order, aliases only) and `settings`
//               ({ hash, runs } per value, sorted by count then hash)
// AC-STE-813.4  groups stay keyed by (skill, category, size); cells keep meaning
// AC-STE-813.5  schema `dpt-retro-trend/2`; no reader in the repo names /1
// AC-STE-813.6  docs/retro-reference.md
// AC-STE-813.7  is the full-suite gate the orchestrator runs; no test here.
//
// Shapes assumed (read off the FR's Technical Design):
//   - retro_trend.ts exports `collectRuns(projectRoot)`, each run carrying its
//     FR id (`fr`, or the existing `id`), `skill` and a boolean `incomplete`.
//     The incomplete flag is not a report key under this FR (STE-812 surfaces
//     it), so AC-.1's incomplete clause is pinned through that export only.
//   - "sorted by count then hash": most runs first, ties by hash ascending.
//   - The ledger `skill` and the run-start `skill` are the same full
//     `dev-process-toolkit:<name>` string (token_usage.attributeLine compares
//     them verbatim), so the fixture uses that form in both.
//
// Every tree is a temp git checkout outside the repo. All ids are synthetic.

import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import {
  BRANCH,
  GIT_ENV,
  PLUGIN_ROOT,
  SETUP_MD,
  UUID_RE,
  cleanupTemps,
  reportFiles,
  retroDir,
  runRetro,
  sid,
  tempDir,
  tokenRow,
  writeTokenLedger,
} from "./_m_d1b4b7_retro_fixture";

afterAll(cleanupTemps);

const SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src");
const TREND_MOD = join(SRC, "retro_trend.ts");
const PROPOSAL_MOD = join(SRC, "retro_proposal.ts");
const RETRO_REFERENCE = join(PLUGIN_ROOT, "docs", "retro-reference.md");
const LONG = 120_000;

const IMPL = "dev-process-toolkit:implement";
const TDD = "dev-process-toolkit:tdd";
const UNKNOWN = "settings unknown";
const H1 = "1".repeat(64);
const H2 = "2".repeat(64);
const H3 = "3".repeat(64);

const FRS = ["STE-9301", "STE-9302", "STE-9303", "STE-9304", "STE-9305"];
/** Each FR's implement session is sid(i+1); its tdd session is sid(11+i). */
const implSession = (i: number) => sid(i + 1);
const tddSession = (i: number) => sid(11 + i);
/** Implement output tokens per FR; every FR changes 20 lines. */
const IMPL_TOKENS = [100, 100, 200, 600, 600]; // per line [5,5,10,30,30]: median 10, delta 25
const TDD_TOKENS = 300; // per line 15 each: median 15, delta 0
const LINES = 20;

const BASE = Date.parse("2026-09-01T10:00:00.000Z");
const DAY = 86_400_000;
const at = (days: number, hours = 0): string => new Date(BASE + days * DAY + hours * 3_600_000).toISOString();

function gitAt(cwd: string, when: string, ...args: string[]): string {
  const p = spawnSync("git", args, {
    cwd,
    encoding: "utf-8",
    env: { ...process.env, ...GIT_ENV, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when },
  });
  if (p.status !== 0) throw new Error(`git ${args.join(" ")}: ${p.stderr}`);
  return p.stdout ?? "";
}

const SETTINGS =
  'schema_version: 1\nmin_dpt_version: "3.0.0"\n' +
  "tracking:\n" +
  "  token_stats:\n    enabled: true\n" +
  "  gate_outcomes:\n    enabled: true\n" +
  "  tool_calls:\n    enabled: true\n" +
  "  review_findings:\n    enabled: true\n";

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

function startRow(session: string, skill: string, fr: string | null, startedAt: string, hash: string): Record<string, unknown> {
  return {
    schema: "dpt-run-start/1",
    session_id: session,
    skill,
    fr,
    started_at: startedAt,
    settings_hash: hash,
    settings: {},
    plugin_version: "0.0.0-synthetic",
    registration: null,
  };
}

/**
 * Run-start rows, in FILE order (a later start is written before an earlier
 * one where "earliest" must win over "first in file"):
 *   STE-9301 implement — FR match H2 (later) then FR match H1 (earlier, in a
 *            session that is not a run session), plus an even earlier session
 *            match H3 that the FR match outranks                     -> H1
 *   STE-9302 implement — no FR match; session matches H1 (later) then H2
 *            (earlier), plus an earliest same-session row of another skill
 *            (tdd, H3) that must not count                           -> H2
 *   STE-9302 tdd       — FR match H3                                 -> H3
 *   STE-9303 implement — only a same-FR row of another skill         -> unknown
 *   STE-9304 / 9305 implement — FR match H1                          -> H1
 *   every other tdd run                                               -> unknown
 */
const RUN_STARTS = [
  startRow(implSession(0), IMPL, FRS[0]!, at(0, 2), H2),
  startRow(sid(50), IMPL, FRS[0]!, at(0, 1), H1),
  startRow(implSession(0), IMPL, null, at(0, 0), H3),
  startRow(implSession(1), IMPL, null, at(2, 2), H1),
  startRow(implSession(1), IMPL, null, at(2, 1), H2),
  startRow(implSession(1), TDD, null, at(2, 0), H3),
  startRow(tddSession(1), TDD, FRS[1]!, at(2, 3), H3),
  startRow(implSession(2), "dev-process-toolkit:gate-check", FRS[2]!, at(4, 0), H1),
  startRow(implSession(3), IMPL, FRS[3]!, at(6, 0), H1),
  startRow(implSession(4), IMPL, FRS[4]!, at(8, 0), H1),
];

const EXPECTED_IMPL_SETTINGS = [H1, H2, UNKNOWN, H1, H1];
const EXPECTED_TDD_SETTINGS = [UNKNOWN, H3, UNKNOWN, UNKNOWN, UNKNOWN];

interface FixtureOpts {
  /** false: no run-start ledger at all (a ledger written before this release). */
  runStarts?: boolean;
}

/** Five archived FRs, each with a claimed implement row and a claimed tdd row in separate sessions. */
function buildFixture(label: string, o: FixtureOpts = {}): string {
  const root = join(tempDir(`ste813-${label}`), "repo");
  mkdirSync(root, { recursive: true });
  gitAt(root, at(-2), "init", "-q", "-b", BRANCH);
  writeFileSync(join(root, "CLAUDE.md"), SETUP_MD);
  writeFileSync(join(root, "package.json"), '{"name":"fixture","version":"0.0.0","private":true}\n');
  mkdirSync(join(root, "specs", "frs", "archive"), { recursive: true });
  writeFileSync(join(root, "specs", "settings.yaml"), SETTINGS);
  mkdirSync(join(root, ".dpt"), { recursive: true });
  writeFileSync(join(root, ".dpt", ".gitignore"), "ledger/\nscratch/\n");
  mkdirSync(join(root, "src"), { recursive: true });
  FRS.forEach((id, i) => writeFileSync(join(root, "specs", "frs", "archive", `${id}.md`), frFile(id, at(2 * i + 1).replace(/\.000Z$/, "Z"))));
  gitAt(root, at(-1), "add", "-A");
  gitAt(root, at(-1), "commit", "-q", "-m", "chore: fixture setup");

  const msgFile = join(root, "..", "msg.txt");
  FRS.forEach((id, i) => {
    writeFileSync(join(root, "src", `${id}.txt`), linesOf(LINES, id));
    gitAt(root, at(2 * i), "add", "-A");
    writeFileSync(msgFile, `feat(core): deliver ${id}\n\nRefs: ${id}\n`);
    gitAt(root, at(2 * i), "commit", "-q", "-F", msgFile);
  });

  // Ledger: FRs 1-3 list the implement row first, FRs 4-5 the tdd row first,
  // so no file-order pick can put every FR under one skill.
  const rows: unknown[] = [];
  FRS.forEach((id, i) => {
    const impl = tokenRow(implSession(i), IMPL_TOKENS[i]!, { skill: IMPL, claimed_by: id });
    // STE-9303's tdd row is an incomplete fork row (STE-812's `complete: false`).
    const tdd = tokenRow(tddSession(i), TDD_TOKENS, { skill: TDD, claimed_by: id, ...(i === 2 ? { complete: false } : {}) });
    rows.push(...(i < 3 ? [impl, tdd] : [tdd, impl]));
  });
  writeTokenLedger(root, rows);

  if (o.runStarts !== false) {
    const p = join(root, ".dpt", "ledger", "run-starts.jsonl");
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, RUN_STARTS.map((r) => JSON.stringify(r)).join("\n") + "\n");
  }
  return realpathSync(root);
}

interface TrendRun {
  root: string;
  text: string;
  report: any;
}

function runTrend(root: string, extra: string[] = []): TrendRun {
  const r = runRetro(root, ["--trend", ...extra]);
  if (r.status !== 0) throw new Error(`retro.ts --trend exited ${r.status}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  const files = reportFiles(root).filter((f) => f.startsWith("trend-"));
  if (files.length !== 1) throw new Error(`expected one trend report, found ${JSON.stringify(reportFiles(root))}`);
  const text = readFileSync(join(retroDir(root), files[0]!), "utf-8");
  return { root, text, report: JSON.parse(text) };
}

const memo = new Map<string, TrendRun>();
function trendFor(label: string, o: FixtureOpts = {}, extra: string[] = []): TrendRun {
  const hit = memo.get(label);
  if (hit !== undefined) return hit;
  const run = runTrend(buildFixture(label, o), extra);
  memo.set(label, run);
  return run;
}
const mixed = () => trendFor("mixed");

function group(report: any, skill: string): any {
  const gs = (report.groups as any[]).filter((x) => x.skill === skill && x.category === "Added" && x.size === "S");
  if (gs.length !== 1) throw new Error(`expected one ${skill}/Added/S group, found ${gs.length}: ${JSON.stringify(report.groups)}`);
  return gs[0];
}
function metric(g: any, id: string): any {
  const m = (g.metrics as any[]).find((x) => x.id === id);
  if (m === undefined) throw new Error(`no metric ${id}: ${JSON.stringify(g.metrics)}`);
  return m;
}
function detail(g: any): any[] {
  if (!Array.isArray(g.runs_detail)) throw new Error(`group has no runs_detail array: ${JSON.stringify(Object.keys(g))}`);
  return g.runs_detail as any[];
}
function entryFor(g: any, fr: string): any {
  const e = detail(g).find((x) => x.fr === fr);
  if (e === undefined) throw new Error(`no runs_detail entry for ${fr}: ${JSON.stringify(g.runs_detail)}`);
  return e;
}

/** First 16 hex of sha256 — computed here, not through session_aliases.ts. */
const digestOf = (raw: string): string => createHash("sha256").update(raw).digest("hex").slice(0, 16);

/** The digests a list of aliases stands for, via the report's own `sessions[]`. */
function digestsOf(report: any, aliases: unknown): string[] {
  if (!Array.isArray(aliases)) throw new Error(`sessions is not an array: ${JSON.stringify(aliases)}`);
  const byAlias = new Map((report.sessions as any[]).map((s) => [s.alias as string, s.digest as string]));
  return aliases.map((a) => {
    const d = byAlias.get(a as string);
    if (d === undefined) throw new Error(`alias ${JSON.stringify(a)} is not in the report's sessions[]`);
    return d;
  });
}

// ===========================================================================
// AC-STE-813.1 — one run per (archived FR, skill)
// ===========================================================================

describe("AC-STE-813.1 a run is one (archived FR, skill)", () => {
  test(
    "AC-STE-813.1 five two-skill FRs yield an implement group and a tdd group of five runs each",
    () => {
      const r = mixed().report;
      expect({ impl: group(r, IMPL).runs, tdd: group(r, TDD).runs }).toEqual({ impl: 5, tdd: 5 });
    },
    LONG,
  );

  test(
    "AC-STE-813.1 a two-skill FR appears as a run in both groups",
    () => {
      const r = mixed().report;
      expect(detail(group(r, IMPL)).map((e) => e.fr)).toEqual(FRS);
      expect(detail(group(r, TDD)).map((e) => e.fr)).toEqual(FRS);
    },
    LONG,
  );

  test(
    "AC-STE-813.1 a run's sessions are its own skill's sessions only",
    () => {
      const r = mixed().report;
      const impl = entryFor(group(r, IMPL), FRS[0]!);
      const tdd = entryFor(group(r, TDD), FRS[0]!);
      expect({ impl: digestsOf(r, impl.sessions), tdd: digestsOf(r, tdd.sessions) }).toEqual({
        impl: [digestOf(implSession(0))],
        tdd: [digestOf(tddSession(0))],
      });
    },
    LONG,
  );

  test(
    "AC-STE-813.1 output tokens per skill over shared lines: implement tokens median 10 delta 25, tdd median 15 delta 0",
    () => {
      const r = mixed().report;
      const impl = metric(group(r, IMPL), "tokens");
      const tdd = metric(group(r, TDD), "tokens");
      expect({ median: impl.median, delta: impl.delta, note: impl.note }).toEqual({ median: 10, delta: 25, note: null });
      expect({ median: tdd.median, delta: tdd.delta, note: tdd.note }).toEqual({ median: 15, delta: 0, note: null });
    },
    LONG,
  );

  test(
    "AC-STE-813.1 the incomplete flag comes from the run's own skill's rows",
    async () => {
      const root = buildFixture("incomplete");
      const mod = await import(TREND_MOD);
      expect(typeof mod.collectRuns).toBe("function");
      const runs = mod.collectRuns(root) as any[];
      const flag = (fr: string, skill: string) => {
        const hit = runs.filter((x) => (x.fr ?? x.id) === fr && x.skill === skill);
        if (hit.length !== 1) throw new Error(`expected one run ${fr}/${skill}, found ${hit.length}`);
        return hit[0].incomplete;
      };
      expect({
        tdd3: flag(FRS[2]!, TDD),
        impl3: flag(FRS[2]!, IMPL),
        tdd1: flag(FRS[0]!, TDD),
      }).toEqual({ tdd3: true, impl3: false, tdd1: false });
    },
    LONG,
  );
});

// ===========================================================================
// AC-STE-813.2 — the settings join
// ===========================================================================

describe("AC-STE-813.2 each run names the settings it started under", () => {
  // STE-813 review (Pass 2): a run-start row whose started_at is not a date is never
  // "earliest" — first in the file, it must not beat a later-listed valid row.
  test(
    "a start whose started_at is not a date never wins the earliest pick",
    () => {
      const root = buildFixture("nan-start");
      const p = join(root, ".dpt", "ledger", "run-starts.jsonl");
      const bad = JSON.stringify(startRow(implSession(3), IMPL, FRS[3]!, "not a date", "HBAD"));
      writeFileSync(p, bad + "\n" + readFileSync(p, "utf-8"));
      expect(entryFor(group(runTrend(root).report, IMPL), FRS[3]!).settings).toBe(H1);
    },
    LONG,
  );

  test(
    "AC-STE-813.2 an FR match takes the earliest same-FR, same-skill row, in any session, over an earlier session match",
    () => {
      expect(entryFor(group(mixed().report, IMPL), FRS[0]!).settings).toBe(H1);
    },
    LONG,
  );

  test(
    "AC-STE-813.2 with no FR match, the earliest same-session, same-skill row wins; another skill's row does not count",
    () => {
      expect(entryFor(group(mixed().report, IMPL), FRS[1]!).settings).toBe(H2);
    },
    LONG,
  );

  test(
    "AC-STE-813.2 the FR match is per skill: STE-9302's tdd run reads its own tdd row",
    () => {
      expect(entryFor(group(mixed().report, TDD), FRS[1]!).settings).toBe(H3);
    },
    LONG,
  );

  test(
    "AC-STE-813.2 a run with only another skill's rows reads settings unknown",
    () => {
      expect(entryFor(group(mixed().report, IMPL), FRS[2]!).settings).toBe(UNKNOWN);
    },
    LONG,
  );

  test(
    "AC-STE-813.2 every run's settings, both groups, in window order",
    () => {
      const r = mixed().report;
      expect({
        impl: detail(group(r, IMPL)).map((e) => e.settings),
        tdd: detail(group(r, TDD)).map((e) => e.settings),
      }).toEqual({ impl: EXPECTED_IMPL_SETTINGS, tdd: EXPECTED_TDD_SETTINGS });
    },
    LONG,
  );

  test(
    "AC-STE-813.2 a ledger with no run-start rows reads settings unknown on every run",
    () => {
      const r = trendFor("pre-release", { runStarts: false }).report;
      const all = (r.groups as any[]).flatMap((g) => detail(g).map((e) => e.settings));
      expect(all).toEqual(Array(10).fill(UNKNOWN));
    },
    LONG,
  );
});

// ===========================================================================
// AC-STE-813.3 — runs_detail and the per-hash settings count
// ===========================================================================

describe("AC-STE-813.3 runs_detail and settings", () => {
  test(
    "AC-STE-813.3 runs_detail holds fr, skill, settings and sessions per window run, in window order",
    () => {
      const r = mixed().report;
      const got = detail(group(r, IMPL)).map((e) => ({ fr: e.fr, skill: e.skill, settings: e.settings, sessions: digestsOf(r, e.sessions) }));
      expect(got).toEqual(FRS.map((fr, i) => ({ fr, skill: IMPL, settings: EXPECTED_IMPL_SETTINGS[i], sessions: [digestOf(implSession(i))] })));
    },
    LONG,
  );

  test(
    "AC-STE-813.3 runs_detail sessions are s<N> aliases, and the report holds no raw session id",
    () => {
      const t = mixed();
      const aliases = (t.report.groups as any[]).flatMap((g) => detail(g).flatMap((e) => e.sessions as unknown[]));
      expect(aliases.length).toBe(10);
      for (const a of aliases) expect(a).toMatch(/^s[1-9]\d*$/);
      expect(t.text.match(UUID_RE)).toBeNull();
    },
    LONG,
  );

  test(
    "AC-STE-813.3 implement settings count: H1 3, then the 1-run ties by hash",
    () => {
      expect(group(mixed().report, IMPL).settings).toEqual([
        { hash: H1, runs: 3 },
        { hash: H2, runs: 1 },
        { hash: UNKNOWN, runs: 1 },
      ]);
    },
    LONG,
  );

  test(
    "AC-STE-813.3 tdd settings count includes settings unknown: unknown 4, H3 1",
    () => {
      expect(group(mixed().report, TDD).settings).toEqual([
        { hash: UNKNOWN, runs: 4 },
        { hash: H3, runs: 1 },
      ]);
    },
    LONG,
  );

  test(
    "AC-STE-813.3 --last 3: runs_detail and the settings count cover only the window's runs",
    () => {
      const g = group(trendFor("last3", {}, ["--last", "3"]).report, IMPL);
      expect(detail(g).map((e) => e.fr)).toEqual(FRS.slice(2));
      expect(g.settings).toEqual([
        { hash: H1, runs: 2 },
        { hash: UNKNOWN, runs: 1 },
      ]);
    },
    LONG,
  );
});

// ===========================================================================
// AC-STE-813.4 — groups stay keyed by (skill, category, size)
// ===========================================================================

describe("AC-STE-813.4 settings never decide the grouping", () => {
  test(
    "AC-STE-813.4 three settings values under implement still make one implement group; two groups in all",
    () => {
      const r = mixed().report;
      const keys = (r.groups as any[]).map((g) => `${g.skill}/${g.category}/${g.size}`).sort();
      expect(keys).toEqual([`${IMPL}/Added/S`, `${TDD}/Added/S`]);
    },
    LONG,
  );

  test(
    "AC-STE-813.4 a group's keys are the old cells plus runs_detail and settings, no settings-valued key",
    () => {
      const g = group(mixed().report, IMPL);
      expect(Object.keys(g).sort()).toEqual(["category", "metrics", "runs", "runs_detail", "settings", "signals", "size", "skill"]);
    },
    LONG,
  );

  test(
    "AC-STE-813.4 the group's runs count equals its runs_detail length",
    () => {
      const r = trendFor("last3", {}, ["--last", "3"]).report;
      for (const g of r.groups as any[]) expect({ skill: g.skill, runs: g.runs, detail: detail(g).length }).toEqual({ skill: g.skill, runs: 3, detail: 3 });
    },
    LONG,
  );
});

// ===========================================================================
// AC-STE-813.5 — schema dpt-retro-trend/2, and every reader accepts it
// ===========================================================================

/** Every file under `dir` (recursive), skipping node_modules. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

describe("AC-STE-813.5 schema dpt-retro-trend/2", () => {
  test(
    "AC-STE-813.5 the report's schema is dpt-retro-trend/2",
    () => {
      expect(mixed().report.schema).toBe("dpt-retro-trend/2");
    },
    LONG,
  );

  test("AC-STE-813.5 TREND_SCHEMA is dpt-retro-trend/2", async () => {
    const mod = await import(TREND_MOD);
    expect(mod.TREND_SCHEMA).toBe("dpt-retro-trend/2");
  });

  test("AC-STE-813.5 no shipped source, skill or doc still names dpt-retro-trend/1", () => {
    const roots = ["adapters", "skills", "docs", "hooks", "templates", "scripts", "agents"].map((d) => join(PLUGIN_ROOT, d)).filter((d) => existsSync(d));
    // Guard: the scan reads the module that writes the schema, so zero hits is not an empty scan.
    const files = roots.flatMap(walk);
    expect(files).toContain(TREND_MOD);
    const stale = files.filter((f) => readFileSync(f, "utf-8").includes("dpt-retro-trend/1")).map((f) => relative(PLUGIN_ROOT, f));
    expect(stale).toEqual([]);
  });

  test(
    "AC-STE-813.5 retro_proposal still recognises a /2 trend report and refuses it",
    async () => {
      const t = mixed();
      expect(t.report.schema).toBe("dpt-retro-trend/2");
      const { proposeLines } = await import(PROPOSAL_MOD);
      expect(() => proposeLines(t.root, t.text)).toThrow();
    },
    LONG,
  );
});

// ===========================================================================
// AC-STE-813.6 — docs/retro-reference.md
// ===========================================================================

function trendSection(): string {
  const doc = readFileSync(RETRO_REFERENCE, "utf-8");
  const start = doc.indexOf("\n## Trend\n");
  if (start < 0) throw new Error("docs/retro-reference.md has no ## Trend section");
  const rest = doc.slice(start + 1);
  const next = rest.indexOf("\n## ", 3);
  return next < 0 ? rest : rest.slice(0, next);
}

describe("AC-STE-813.6 docs/retro-reference.md", () => {
  test("AC-STE-813.6 the Trend section defines the run unit as one run per (archived FR, skill)", () => {
    expect(trendSection()).toContain("(archived FR, skill)");
  });

  test("AC-STE-813.6 the Trend section no longer says a run's skill is its first claimed row's skill", () => {
    expect(trendSection()).not.toMatch(/first claimed ledger row/);
  });

  test("AC-STE-813.6 the Trend section gives the settings join order: FR and skill, then session and skill, then settings unknown", () => {
    const s = trendSection();
    const para = s.split("\n\n").find((p) => p.includes("settings unknown") && p.includes("settings_hash"));
    expect(para).toBeString();
    const fr = para!.search(/\bFR\b[^.]*\bskill\b/);
    const session = para!.search(/\bsessions?\b[^.]*\bskill\b/);
    const unknown = para!.indexOf("settings unknown");
    expect({ fr: fr >= 0, session: session >= 0 }).toEqual({ fr: true, session: true });
    expect(fr < session && session < unknown).toBe(true);
  });

  test("AC-STE-813.6 the Trend section names the two new group keys runs_detail and settings", () => {
    const s = trendSection();
    expect({ runs_detail: s.includes("`runs_detail`"), settings: s.includes("`settings`") }).toEqual({ runs_detail: true, settings: true });
  });

  test("AC-STE-813.6 the Trend section names schema dpt-retro-trend/2", () => {
    expect(trendSection()).toContain("dpt-retro-trend/2");
  });
});
