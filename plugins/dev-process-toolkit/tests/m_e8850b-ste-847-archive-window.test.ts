// STE-847 (M_e8850b) — the live-checkout grade between the archive and the release.
//
// The grade under test lives in tests/_live_checkout_grading.ts:
//   gradeLiveCheckout(projectRoot, table = GATE_PROBES): Promise<string[]>
// It runs `table` through the probe runner and plan_ship_coherence for the
// kinds, and returns one line per refusal; [] means the checkout is accepted.
//
// It is imported dynamically so the regression below, which drives only the
// shipped suites, runs unchanged on the code before the fix.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  realpathSync, renameSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { archiveFRWithFlip } from "../adapters/_shared/src/archive_fr";
import { GATE_PROBES, runGateProbes, type GateProbeEntry } from "../adapters/_shared/src/gate_probe_runner";
import { runPlanShipCoherenceProbe } from "../adapters/_shared/src/plan_ship_coherence";
import { repairArchivedPlanLinks, rewriteArchiveLinks } from "../adapters/_shared/src/spec_archive/rewrite_links";
import { runNestedBunTest } from "./_nested_bun_test";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const PLUGIN_REL = join("plugins", "dev-process-toolkit");
const PIN_SUITE = "m_d1e7b1-ste-756-gate-probe-runner.test.ts";
const PIN_TITLE = "the runner's summary on this checkout reads";
const GRADING = join(import.meta.dir, "_live_checkout_grading.ts");

// ---------------------------------------------------------------------------
// The archived, unshipped copy of this checkout
// ---------------------------------------------------------------------------

/** A long-shipped milestone, so removing its stamp leaves the release surfaces agreeing. */
const WINDOW_PLAN = "M_870603";
const ARCHIVED_AT = "2026-11-14T09:33:27Z";

function gitEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
}

function git(cwd: string, ...args: string[]): string {
  const p = spawnSync("git", args, { cwd, env: gitEnv(), encoding: "utf8", timeout: 60_000, maxBuffer: 64 << 20 });
  if (p.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${p.stderr}`);
  return p.stdout;
}

/** Clone this checkout, uncommitted files included, and put it in the window. */
async function buildWindow(dir: string): Promise<string> {
  const root = join(dir, "checkout");
  git(REPO_ROOT, "clone", "-q", "-s", REPO_ROOT, root);
  // The grading module and the pin may not be committed yet: overlay the working tree.
  const list = (...args: string[]) => git(REPO_ROOT, "ls-files", "-z", ...args, "--", "specs", "plugins").split("\0").filter(Boolean);
  for (const rel of new Set(list("-m", "-o", "--exclude-standard"))) {
    if (!existsSync(join(REPO_ROOT, rel))) continue;
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    copyFileSync(join(REPO_ROOT, rel), join(root, rel));
  }
  // Every tracked file deleted here, staged or not.
  const deleted = git(REPO_ROOT, "diff", "--no-renames", "--name-only", "--diff-filter=D", "-z", "HEAD", "--", "specs", "plugins");
  for (const rel of deleted.split("\0").filter(Boolean)) rmSync(join(root, rel), { force: true });
  // Staged additions and edits are neither -m nor -o.
  const staged = git(REPO_ROOT, "diff", "--no-renames", "--name-only", "--diff-filter=AM", "-z", "HEAD", "--", "specs", "plugins");
  for (const rel of staged.split("\0").filter(Boolean)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    copyFileSync(join(REPO_ROOT, rel), join(root, rel));
  }
  for (const rel of ["node_modules", join(PLUGIN_REL, "node_modules")]) {
    if (existsSync(join(REPO_ROOT, rel)) && !existsSync(join(root, rel))) symlinkSync(join(REPO_ROOT, rel), join(root, rel));
  }

  // Reopen a shipped plan and its FRs, then archive them through the shipped code.
  const reopen = (archiveRel: string): string => {
    const text = readFileSync(join(root, archiveRel), "utf8");
    const live = archiveRel.replace("/archive/", "/");
    writeFileSync(
      join(root, archiveRel),
      text.replace(/^status: archived$/m, "status: active").replace(/^archived_at: .*$/m, "archived_at: null").replace(/^shipped_in: .*\n/m, ""),
    );
    renameSync(join(root, archiveRel), join(root, live));
    return live;
  };
  const frs = readdirSync(join(root, "specs/frs/archive"))
    .filter((n) => n.endsWith(".md") && readFileSync(join(root, "specs/frs/archive", n), "utf8").includes(`\nmilestone: ${WINDOW_PLAN}\n`))
    .map((n) => reopen(`specs/frs/archive/${n}`));
  if (frs.length === 0) throw new Error(`no FR of ${WINDOW_PLAN} found`);
  const plan = reopen(`specs/plan/archive/${WINDOW_PLAN}.md`);
  for (const live of [...frs, plan]) {
    renameSync(join(root, live), join(root, dirname(live), "archive", basename(live)));
    await archiveFRWithFlip(root, live, ARCHIVED_AT);
  }
  for (const fr of frs) rewriteArchiveLinks(root, basename(fr, ".md"));
  repairArchivedPlanLinks(root, `specs/plan/archive/${WINDOW_PLAN}.md`);
  git(root, "add", "-A");
  git(
    root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.com", "-c", "gc.auto=0", "-c", "core.hooksPath=/dev/null",
    "-c", "commit.gpgsign=false", "commit", "-q", "-m", "chore(specs): archive",
  );
  return root;
}

let base = "";
let windowRoot = "";
beforeAll(async () => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "ste-847-")));
  windowRoot = await buildWindow(base);
}, 120_000);
afterAll(() => {
  // bun's rmSync can leave a .git behind.
  if (base) spawnSync("rm", ["-rf", base], { timeout: 60_000 });
});

/**
 * The kill deadline of one nested run. It is longer than the pin's own 300 s
 * budget, so a slow test is named by bun's own timeout before this kills it.
 */
const WINDOW_RUN_MS = 330_000;

/** Run one named test of a suite inside the copy. A kill is said out loud. */
function runInWindow(suite: string, title: string, timeoutMs = WINDOW_RUN_MS) {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const p = runNestedBunTest([join("tests", suite), "-t", escaped], {
    cwd: join(windowRoot, PLUGIN_REL),
    env: gitEnv(),
    timeoutMs,
  });
  const why = p.timedOut ? `[${suite} was killed after ${timeoutMs} ms: a timeout, not a window verdict] ${p.note}\n` : p.note ? `${p.note}\n` : "";
  return { exitCode: p.exitCode, timedOut: p.timedOut, out: `${why}${p.stdout}${p.stderr}` };
}

/** The run finished on its own; the tail goes in the message so a failure is readable. */
function expectFinished(r: ReturnType<typeof runInWindow>): void {
  expect(r.timedOut, r.out.slice(0, 400) + r.out.slice(-2000)).toBe(false);
}

describe("AC-STE-847.1 regression", () => {
  test("an archived unshipped plan is the only failure the live-checkout grade ignores", async () => {
    const before = await runPlanShipCoherenceProbe(windowRoot);
    expect(before.violations.map((v) => v.kind)).toContain("unshipped_debt");
    const inWindow = runInWindow(PIN_SUITE, PIN_TITLE);
    expectFinished(inWindow);
    expect(inWindow.out).toMatch(/Ran 1 test across 1 file/);
    expect(inWindow.exitCode, inWindow.out.slice(-3000)).toBe(0);

    const plan = join(windowRoot, "specs/plan/archive", `${WINDOW_PLAN}.md`);
    const text = readFileSync(plan, "utf8");
    try {
      writeFileSync(plan, text.replace(/^archived_at: .*$/m, "$&\nshipped_in: v99.99.99"));
      const corrupt = runInWindow(PIN_SUITE, PIN_TITLE);
      expectFinished(corrupt);
      expect(corrupt.out).toMatch(/\n\s*1 fail\b/);
    } finally {
      writeFileSync(plan, text);
    }
  }, 2 * WINDOW_RUN_MS + 60_000);
});

describe("AC-STE-847.1 / .5 the nested runs say when they were killed", () => {
  test("a run killed at its deadline reports timedOut and says so", () => {
    const r = runInWindow(PIN_SUITE, PIN_TITLE, 1);
    expect(r.timedOut).toBe(true);
    expect(r.exitCode).not.toBe(0);
    expect(r.out).toContain("killed after 1 ms: a timeout");
    expect(r.out).toContain("timed out");
  });

  test("the kill deadline is longer than the pin's own budget", () => {
    const src = readFileSync(join(import.meta.dir, PIN_SUITE), "utf8");
    const start = src.indexOf(`test("${PIN_TITLE}`);
    const budget = /\}, (\d[\d_]*)\);/.exec(src.slice(start))!;
    expect(Number(budget[1]!.replaceAll("_", ""))).toBeLessThan(WINDOW_RUN_MS);
  });
});

// ---------------------------------------------------------------------------
// Which suites call a probe-#63 grade on the live root, however it is spelled
// ---------------------------------------------------------------------------

const LIVE_ROOT = join(PLUGIN_ROOT, "..", "..");
const GRADE_CALL = /\b(?:runPlanShipCoherenceProbe|runGateProbes|gradeLiveCheckout)\s*\(/g;
type PathVal = string | PathVal[];

/** The text of one expression from `i`, up to a top-level stop character. */
function takeExpr(src: string, i: number, stops: string): string {
  return src.slice(i, exprEnd(src, i, stops)).trim();
}

/** Where the expression from `i` ends: at a top-level stop character or an unmatched closer. */
function exprEnd(src: string, i: number, stops: string): number {
  let depth = 0;
  let j = i;
  for (; j < src.length; j++) {
    const ch = src[j]!;
    if (ch === '"' || ch === "'" || ch === "`") {
      for (j++; j < src.length && src[j] !== ch; j++) if (src[j] === "\\") j++;
      continue;
    }
    if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) {
      if (depth === 0) break;
      depth--;
    } else if (depth === 0 && stops.includes(ch)) break;
  }
  return j;
}

/** The top-level items of a list that starts at `i`, each with its offset. */
function listItems(src: string, i: number): Array<{ at: number; text: string }> {
  const end = exprEnd(src, i, "");
  const items: Array<{ at: number; text: string }> = [];
  for (let k = i; k < end; ) {
    const stop = Math.min(exprEnd(src, k, ","), end);
    const text = src.slice(k, stop).trim();
    if (text !== "") items.push({ at: k, text });
    k = stop + 1;
  }
  return items;
}

/** Evaluate a path made only of string literals, join/resolve/dirname, the tests dir and known names. */
function evalPath(expr: string, env: Map<string, PathVal>): PathVal | undefined {
  if (expr.startsWith("[") && takeExpr(expr, 1, "") === expr.slice(1, -1).trim()) {
    // An array literal: read each element on its own; one we cannot read is not the live root.
    const items: PathVal[] = [];
    for (let i = 1; i < expr.length - 1; ) {
      const item = takeExpr(expr, i, ",");
      if (item !== "") items.push(evalPath(item, env) ?? "");
      i = expr.indexOf(item, i) + item.length + 1;
      if (item === "") break;
    }
    return items;
  }
  const e =expr.replace(/\bimport\.meta\.dir(?:name)?\b|\b__dirname\b/g, "__D");
  const bare = e.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
  if (bare === "" || /[`;={}]/.test(bare)) return undefined;
  const known: Record<string, unknown> = { join, resolve, dirname, __D: import.meta.dir, path: { join, resolve, dirname } };
  for (const name of bare.replace(/\.\s*(?:join|resolve|dirname)\b/g, "").match(/[A-Za-z_$][\w$]*/g) ?? []) {
    if (!(name in known) && !env.has(name)) return undefined;
  }
  const names = [...Object.keys(known), ...env.keys()];
  try {
    const v = new Function(...names, `return (${e});`)(...Object.values(known), ...env.values());
    const ok = (x: unknown): boolean => typeof x === "string" || (Array.isArray(x) && x.every(ok));
    return ok(v) ? (v as PathVal) : undefined;
  } catch {
    return undefined;
  }
}

const isLive = (v: PathVal | undefined): boolean =>
  typeof v === "string" ? v === LIVE_ROOT : Array.isArray(v) && v.some(isLive);

/** Every probe-#63 grade call in `src` whose root argument is the live checkout, as `line: argument`. */
function liveRootCalls(src: string): string[] {
  return liveRootGrades(src).map((g) => `${lineOf(src, g.at)}: ${g.arg}`);
}

const lineOf = (src: string, at: number): number => src.slice(0, at).split("\n").length;
const RUNNER_FILE = "gate_probe_runner";

/**
 * Every grade of the live checkout in `src`, with its offset: an in-process
 * call, or a spawned `gate_probe_runner.ts` given the live root as a later
 * argument (an argument list, or a command string).
 */
function liveRootGrades(src: string): Array<{ at: number; arg: string }> {
  const env = new Map<string, PathVal>();
  // The house names for the live root count even where their value cannot be read.
  const live = new Set<string>(["REPO_ROOT", "repoRoot"]);
  const decls = [...src.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=(?!=)/g)]
    .map((m) => [m[1]!, takeExpr(src, m.index! + m[0].length, ";\n,")] as const);
  const loops = [...src.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s+of\s+/g)]
    .map((m) => [m[1]!, takeExpr(src, m.index! + m[0].length, "")] as const);
  for (let pass = 0; pass < 6; pass++) {
    for (const [name, expr] of decls) {
      const v = evalPath(expr, env);
      if (v === undefined) continue;
      if (!env.has(name)) env.set(name, v);
      if (isLive(v)) live.add(name);
    }
    for (const [name, expr] of loops) if (isLive(evalPath(expr, env))) live.add(name);
  }
  const isLiveArg = (arg: string): boolean => live.has(arg) || isLive(evalPath(arg, env));
  const hits: Array<{ at: number; arg: string }> = [];
  for (const m of src.matchAll(GRADE_CALL)) {
    const arg = takeExpr(src, m.index! + m[0].length, ",");
    if (isLiveArg(arg)) hits.push({ at: m.index!, arg });
  }
  // A name that holds the runner's path, however it is built.
  const runners = new Set<string>();
  for (let pass = 0; pass < 6; pass++) {
    for (const [name, expr] of decls) if (expr.includes(RUNNER_FILE) || runners.has(expr)) runners.add(name);
  }
  const isRunner = (item: string): boolean => item.includes(RUNNER_FILE) || runners.has(item);
  // Spawned through an argument list: the runner, then the live root.
  for (const m of src.matchAll(/\[/g)) {
    const items = listItems(src, m.index! + 1);
    const r = items.findIndex((it) => isRunner(it.text));
    if (r < 0) continue;
    const root = items.slice(r + 1).find((it) => isLiveArg(it.text));
    if (root) hits.push({ at: root.at, arg: root.text });
  }
  // Spawned through one command string on one line: `bun ${RUNNER} ${REPO_ROOT}`.
  for (const m of src.matchAll(/^.*$/gm)) {
    const holes = [...m[0].matchAll(/\$\{([^{}]*)\}/g)].map((h) => ({ at: h.index!, arg: h[1]!.trim() }));
    const named = holes.find((h) => runners.has(h.arg))?.at ?? -1;
    const from = m[0].includes(RUNNER_FILE) ? m[0].indexOf(RUNNER_FILE) : named;
    const root = from < 0 ? undefined : holes.find((h) => h.at > from && isLiveArg(h.arg));
    if (root) hits.push({ at: m.index! + root.at, arg: root.arg });
  }
  return hits.sort((a, b) => a.at - b.at);
}

/** The title of the innermost `test(...)` whose body holds offset `at`. */
function enclosingTitle(src: string, at: number): string | undefined {
  let best: { open: number; title: string } | undefined;
  for (const m of src.matchAll(/(?<![\w$.])(?:test|it)\s*\(/g)) {
    const open = m.index! + m[0].length;
    if (open > at || exprEnd(src, open, "") < at || (best && best.open > open)) continue;
    const raw = takeExpr(src, open, ",");
    const quoted = /^(["'`])([\s\S]*)\1$/.exec(raw);
    best = { open, title: quoted ? quoted[2]! : raw };
  }
  return best?.title;
}

describe("AC-STE-847.5 every live-checkout test that grades probe #63 accepts the window", () => {
  const LIVE: ReadonlyArray<[suite: string, title: string]> = [
    [PIN_SUITE, PIN_TITLE],
    ["m141-ste-546-surface-agreement.test.ts", "probe #63 over the live tree is clean, unshipped debt excluded"],
    ["gate-check-plan-ship-coherence.test.ts", "every stamped archive plan resolves to a CHANGELOG heading (no corrupt stamps)"],
    ["m_79b1f6-ste-588-sibling-coherence.test.ts", "the live repo root declares no span and yields no sibling row and no sibling note"],
    // Nested: runs the 756 suite, the pin included.
    ["m120-ste-444-jira-binding-prose.test.ts", "every at-risk suite passes with zero failures after the edit"],
  ];

  for (const [suite, title] of LIVE) {
    test(`${suite} accepts the archived, unshipped tree`, () => {
      const r = runInWindow(suite, title);
      expectFinished(r);
      expect(r.out).toMatch(/\bRan 1 test across 1 file/);
      expect(r.exitCode, r.out.slice(-3000)).toBe(0);
    }, WINDOW_RUN_MS + 30_000);
  }

  test("the list names every suite that grades probe #63 on this checkout", () => {
    const direct = readdirSync(import.meta.dir)
      .filter((n) => n.endsWith(".test.ts") && n !== basename(import.meta.path))
      .filter((n) => liveRootCalls(readFileSync(join(import.meta.dir, n), "utf8")).length > 0)
      .sort();
    expect(direct).toEqual(LIVE.map(([s]) => s).filter((s) => !s.startsWith("m120-")).sort());
  });

  // Live-root grades that run the whole table but read no #63 verdict, so the window cannot red them.
  const NOT_63: ReadonlyArray<[suite: string, title: string, why: string]> = [
    [PIN_SUITE, "AC-STE-756.3 — the runner over this repository checkout does not grade #81's warning catalogue row as `fail`", "reads only the #81 row"],
    [PIN_SUITE, "AC-STE-756.4 — every shipped entry's real report has a known shape, on this checkout and on an empty project", "reads only the report shapes"],
  ];
  const suites = (): Map<string, string> =>
    new Map(
      readdirSync(import.meta.dir)
        .filter((n) => n.endsWith(".test.ts") && n !== basename(import.meta.path))
        .map((n) => [n, readFileSync(join(import.meta.dir, n), "utf8")]),
    );
  /** Every live-root grade, as `suite:line (title)`, keyed by where it sits. */
  const gradesBySite = (files: Map<string, string>) =>
    [...files].flatMap(([suite, src]) =>
      liveRootGrades(src).map((g) => {
        const title = enclosingTitle(src, g.at);
        return { suite, title, where: `${suite}:${lineOf(src, g.at)} (${title ?? "outside any test"})` };
      }),
    );
  // `-t` matches a title by substring, as the window run selects it.
  const listed = (rows: ReadonlyArray<readonly [string, string, ...string[]]>, suite: string, title?: string) =>
    rows.some(([s, t]) => s === suite && title !== undefined && title.includes(t));
  /** The live-root grades the window run does not cover. */
  const unlisted = (files: Map<string, string>): string[] =>
    gradesBySite(files).filter((g) => !listed(LIVE, g.suite, g.title) && !listed(NOT_63, g.suite, g.title)).map((g) => g.where);

  test("every live-root grade sits inside a listed title, or is a named grade that reads no #63 verdict", () => {
    const files = suites();
    expect(unlisted(files)).toEqual([]);
    // Neither list holds a stale entry: each names a test that still grades the live root.
    const sites = gradesBySite(files);
    for (const [suite, title] of [...LIVE.filter(([s]) => !s.startsWith("m120-")), ...NOT_63]) {
      expect(sites.some((g) => listed([[suite, title]], g.suite, g.title)), `${suite}: ${title}`).toBe(true);
    }
  });

  test("control: a second live-root #63 grade in a listed suite is caught, though the suite names still agree", () => {
    const files = suites();
    const suite = "m141-ste-546-surface-agreement.test.ts";
    const added = 'test("a second live grade", async () => {\n  expect((await runPlanShipCoherenceProbe(REPO_ROOT)).violations).toEqual([]);\n});\n';
    files.set(suite, `${files.get(suite)!}\n${added}`);
    const names = [...files].filter(([, src]) => liveRootCalls(src).length > 0).map(([n]) => n).sort();
    expect(names).toEqual(LIVE.map(([s]) => s).filter((s) => !s.startsWith("m120-")).sort());
    expect(unlisted(files)).toEqual([expect.stringMatching(new RegExp(`^${suite.replaceAll(".", "\\.")}:\\d+ \\(a second live grade\\)$`))]);
  });

  test("control: a spawned runner given the live root is caught, by path or by name", () => {
    const spawned = [
      'spawnSync("bun", ["adapters/_shared/src/gate_probe_runner.ts", REPO_ROOT]);',
      "runBun([RUNNER, REPO_ROOT], PLUGIN_ROOT, 300_000);",
      "spawnSync(\"sh\", [\"-c\", `bun ${RUNNER} ${REPO_ROOT}`]);",
    ];
    for (const body of spawned) {
      const files = suites();
      files.set(PIN_SUITE, `${files.get(PIN_SUITE)!}\ntest("a spawned grade", () => {\n  ${body}\n});\n`);
      expect(unlisted(files), body).toEqual([expect.stringContaining(`${PIN_SUITE}:`)]);
    }
    // A fixture root handed to the same runner is not the live checkout.
    const head = 'const PLUGIN_ROOT = join(import.meta.dir, "..");\nconst RUNNER = join(PLUGIN_ROOT, "adapters", "_shared", "src", "gate_probe_runner.ts");\n';
    expect(liveRootCalls(`${head}runBun([RUNNER, dir], PLUGIN_ROOT);\nspawnSync("sh", ["-c", \`bun \${RUNNER} /proj\`]);`)).toEqual([]);
    expect(liveRootCalls(`${head}spawnSync("bun", [RUNNER, join(PLUGIN_ROOT, "..", "..")]);`)).toHaveLength(1);
  });

  test("the discovery finds the live root under any spelling, and only the live root", () => {
    const head = 'const PLUGIN_ROOT = join(import.meta.dir, "..");\n';
    const found = (body: string) => liveRootCalls(head + body).length;
    // Found: other names, inline paths, aliases and loops.
    expect(found('const ROOT = join(PLUGIN_ROOT, "..", "..");\nawait runGateProbes(ROOT);')).toBe(1);
    expect(found('await runPlanShipCoherenceProbe(join(import.meta.dir, "..", "..", ".."));')).toBe(1);
    expect(found('await gradeLiveCheckout(resolve(import.meta.dir, "../../.."));')).toBe(1);
    expect(found('const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");\nconst repo = REPO_ROOT;\nawait runGateProbes( repo , table);')).toBe(1);
    expect(found('const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");\nfor (const root of [REPO_ROOT, empty]) await runGateProbes(root);')).toBe(1);
    expect(found('const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");\nconst roots = [REPO_ROOT];\nfor (const r of roots) await runGateProbes(r);')).toBe(1);
    expect(found("await runGateProbes(REPO_ROOT);")).toBe(1);
    // Spared: fixtures, the plugin root, and one level short of the repo.
    expect(found("await runGateProbes(fx.a);")).toBe(0);
    expect(found("await runGateProbes(PLUGIN_ROOT, table);")).toBe(0);
    expect(found('const root = mkdtempSync(join(tmpdir(), "x"));\nawait runGateProbes(root);')).toBe(0);
    expect(found('await runGateProbes(join(import.meta.dir, "..", ".."));')).toBe(0);
    expect(found("const roots = [windowRoot(), corruptRoot()];\nfor (const root of roots) await runPlanShipCoherenceProbe(root);")).toBe(0);
  });

  test("the twice-nested suite (591) judges the window only through the m120 suite run above", () => {
    // Run from here it would pass the nested depth ceiling of 3, one level deeper than in the real suite.
    const src = readFileSync(join(import.meta.dir, "m_79b1f6-ste-591-sibling-by-tracker-id.test.ts"), "utf8");
    expect(src).toContain('expectSuiteGreen("tests/m120-ste-444-jira-binding-prose.test.ts")');
    expect(src).not.toMatch(/runPlanShipCoherenceProbe|runGateProbes/);
  });

  test("the nested at-risk selection really includes the pin's suite", () => {
    expect(readFileSync(join(import.meta.dir, PIN_SUITE), "utf8")).toContain(
      // Split so this file is not itself selected by that marker.
      ["tracker-project-milestone", "attached"].join("-"),
    );
  });
});

// ---------------------------------------------------------------------------
// The verdict table
// ---------------------------------------------------------------------------

type Tree = "clean" | "debt" | "corrupt" | "debt+corrupt";

function makeTree(kind: Tree): string {
  const root = mkdtempSync(join(tmpdir(), "ste-847-fx-"));
  const dir = join(root, "specs", "plan", "archive");
  mkdirSync(dir, { recursive: true });
  const plan = (id: string, stamp: string) =>
    writeFileSync(join(dir, `${id}.md`), `---\nmilestone: ${id}\nstatus: archived\narchived_at: ${ARCHIVED_AT}\n${stamp}---\n\n# Plan\n`);
  if (kind.includes("debt")) plan("M_a0a0a1", "");
  if (kind.includes("corrupt")) plan("M_a0a0a2", "shipped_in: v99.99.99\n");
  return root;
}

const ok = () => ({ violations: [] });
/** The shipped table with every probe but #63 stubbed green. */
const base74 = (): GateProbeEntry[] => GATE_PROBES.map((e) => (e.n === 63 ? { ...e } : { ...e, run: ok }));
const patch = (n: number, run: GateProbeEntry["run"]) => base74().map((e) => (e.n === n ? { ...e, run } : e));
const boom = () => { throw new Error("boom"); };

// Which refusals a case fires, in order: `ids` (the probes run are not the
// registered ones), `owned` (a #63 violation the window does not excuse),
// `row #N` (a failing row) and `summary N/74` (the summary that was expected).
const R37 = () => patch(37, () => ({ violations: [{ severity: "error" }] }));
const EXTRA = () => [...base74(), { n: 999, id: "extra", severity: "error" as const, run: ok }];
const CASES: ReadonlyArray<{ name: string; tree: Tree; table: () => GateProbeEntry[]; fires: string[] }> = [
  { name: "every probe passes", tree: "clean", table: base74, fires: [] },
  { name: "only #63 fails and only with unshipped debt", tree: "debt", table: base74, fires: [] },
  { name: "another row fails, no window", tree: "clean", table: R37, fires: ["row #37", "summary 74/74"] },
  { name: "another row fails beside the debt", tree: "debt", table: R37, fires: ["row #37", "summary 73/74"] },
  { name: "another row throws", tree: "clean", table: () => patch(20, boom), fires: ["row #20", "summary 74/74"] },
  { name: "#63 reports a corrupt stamp without the debt", tree: "corrupt", table: base74, fires: ["owned", "row #63", "summary 74/74"] },
  { name: "#63 reports a corrupt stamp beside the debt", tree: "debt+corrupt", table: base74, fires: ["owned", "row #63", "summary 74/74"] },
  { name: "#63 throws on a clean tree", tree: "clean", table: () => patch(63, boom), fires: ["row #63", "summary 74/74"] },
  { name: "#63 throws on a debt tree", tree: "debt", table: () => patch(63, boom), fires: ["row #63", "summary 74/74"] },
  { name: "#63 fails with no violation behind it", tree: "clean", table: () => patch(63, () => ({ violations: [{}] })), fires: ["row #63", "summary 74/74"] },
  { name: "#63 counts more than the debt", tree: "debt", table: () => patch(63, () => ({ violations: [{}, {}] })), fires: ["row #63", "summary 74/74"] },
  { name: "a missing row", tree: "clean", table: () => base74().filter((e) => e.n !== 37), fires: ["ids", "summary 74/74"] },
  { name: "a missing row in the window", tree: "debt", table: () => base74().filter((e) => e.n !== 37), fires: ["ids", "summary 73/74"] },
  { name: "#63 itself is missing", tree: "debt", table: () => base74().filter((e) => e.n !== 63), fires: ["ids", "summary 74/74"] },
  { name: "an extra row", tree: "clean", table: EXTRA, fires: ["ids", "summary 74/74"] },
  { name: "an extra row in the window", tree: "debt", table: EXTRA, fires: ["ids", "summary 73/74"] },
  { name: "one row replaced by a copy of another, 74 in all", tree: "debt", table: () => [...base74().filter((e) => e.n !== 37), base74()[0]!], fires: ["ids"] },
];

/** Name one refusal line by the check that produced it. */
function fired(refusal: string): string {
  if (refusal === "the probes run are not exactly the registered probes") return "ids";
  if (refusal.startsWith("probe #63: ")) return "owned";
  const row = /^probe #(\d+) \S+: fail \(/.exec(refusal);
  if (row) return `row #${row[1]}`;
  const summary = /^expected `conformance-probes pass: (\d+\/\d+) \[`, got `conformance-probes pass: /.exec(refusal);
  if (summary) return `summary ${summary[1]}`;
  return `unknown: ${refusal}`;
}

type GradeFn = (root: string, table?: GateProbeEntry[]) => Promise<string[]>;

async function grade(c: (typeof CASES)[number], fn?: GradeFn): Promise<string[]> {
  const { gradeLiveCheckout } = (await import("./_live_checkout_grading")) as unknown as { gradeLiveCheckout: GradeFn };
  const root = makeTree(c.tree);
  try {
    return await (fn ?? gradeLiveCheckout)(root, c.table());
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("AC-STE-847.2 / .3 / .4 the live-checkout verdicts", () => {
  for (const c of CASES) {
    test(`${c.fires.length === 0 ? "accepts" : "rejects"}: ${c.name}`, async () => {
      const refusals = await grade(c);
      if (c.fires.length === 0) expect(refusals).toEqual([]);
      else expect(refusals.length).toBeGreaterThan(0);
      expect(refusals.map(fired), refusals.join("\n")).toEqual(c.fires);
    });
  }

  test("AC-STE-847.4 — outside the window the summary is pinned to 74/74", async () => {
    expect(GATE_PROBES.length).toBe(74);
    const refusals = await grade(CASES.find((c) => c.name === "a missing row")!);
    expect(refusals.join("\n")).toContain("74/74");
  });

  test("AC-STE-847.2 — the grade calls gradedViolations and keeps no copy of it", () => {
    const src = readFileSync(GRADING, "utf8");
    const fn = src.slice(src.indexOf("function gradeLiveCheckout("));
    expect(src).toContain("export async function gradeLiveCheckout(");
    expect(fn).toContain("gradedViolations(");
    expect(src).toMatch(/import\s*\{[^}]*gradedViolations[^}]*\}\s*from\s*"\.\/_plan_ship_grading"/);
    // The kind is compared in the shared predicate only.
    expect(src).not.toMatch(/\.kind\b|TRANSIENT_KIND\s*=/);
    expect(src).not.toMatch(/["'`]unshipped_debt["'`]/);
  });

  test("AC-STE-847.2 — the live pin grades through the shared function, not flat", () => {
    const src = readFileSync(join(import.meta.dir, PIN_SUITE), "utf8");
    const start = src.indexOf(`test("${PIN_TITLE}`);
    expect(start).toBeGreaterThan(-1);
    // The body only: the title also says 74/74, so it must not count.
    const open = src.indexOf("async () => {", start);
    expect(open).toBeGreaterThan(start);
    const body = src.slice(open, src.indexOf("300_000", start));
    expect(body).not.toContain(PIN_TITLE);
    expect(body).toMatch(/expect\(await gradeLiveCheckout\(REPO_ROOT\)\)\.toEqual\(\[\]\)/);
    expect(body).not.toContain("summary.startsWith(");
  });

  test("AC-STE-847.4 — the grade, which the pin calls, holds the 74/74 floor", () => {
    const src = readFileSync(GRADING, "utf8");
    expect(src).toContain('const FULL_PASS = "conformance-probes pass: 74/74 [";');
    expect(src).toContain('const WINDOW_PASS = "conformance-probes pass: 73/74 [";');
  });

  test("AC-STE-847.4 — a grade with a loose floor is caught by the verdict table", async () => {
    const loose = await mutantGrade("loose-floor", [['"conformance-probes pass: 74/74 ["', '"conformance-probes pass: "']]);
    expect(await changedCases(loose)).toEqual(
      CASES.filter((c) => c.fires.includes("summary 74/74")).map((c) => c.name),
    );
  });
});

// ---------------------------------------------------------------------------
// AC-STE-847.7 — mutated copies of the grade, run on the same cases
// ---------------------------------------------------------------------------

const mutantDirs: string[] = [];
afterAll(() => {
  for (const d of mutantDirs) rmSync(d, { recursive: true, force: true });
});

/** A copy of the grade with its imports made absolute, so it loads from a temp dir. */
function relocatedGrading(): string {
  const src = readFileSync(GRADING, "utf8")
    .replaceAll('from "../adapters/', `from "${join(PLUGIN_ROOT, "adapters")}/`)
    .replaceAll('from "./_plan_ship_grading"', `from ${JSON.stringify(join(import.meta.dir, "_plan_ship_grading"))}`);
  expect(src).not.toMatch(/from\s+["']\.\.?\//);
  return src;
}

/** Load the grade with each `[from, to]` edit applied; every edit must apply exactly once. */
async function mutantGrade(tag: string, edits: ReadonlyArray<[from: string, to: string]>): Promise<GradeFn> {
  const original = relocatedGrading();
  let src = original;
  for (const [from, to] of edits) {
    expect(src.split(from).length - 1, `${tag}: the edit applies once: ${from}`).toBe(1);
    src = src.replace(from, to);
  }
  if (edits.length > 0) expect(src).not.toBe(original);
  const dir = mkdtempSync(join(tmpdir(), `ste-847-mutant-${tag}-`));
  mutantDirs.push(dir);
  const path = join(dir, "_live_checkout_grading.ts");
  writeFileSync(path, src);
  const mod = (await import(path)) as { gradeLiveCheckout?: GradeFn };
  expect(typeof mod.gradeLiveCheckout).toBe("function");
  return mod.gradeLiveCheckout!;
}

/** The cases whose fired refusals differ from the table under `fn`. */
async function changedCases(fn: GradeFn): Promise<string[]> {
  const out: string[] = [];
  for (const c of CASES) {
    const got = (await grade(c, fn)).map(fired);
    if (got.join("|") !== c.fires.join("|")) out.push(c.name);
  }
  return out;
}

/** The cases a rejecting table entry turns into an accept under `fn`. */
async function acceptedRejects(fn: GradeFn): Promise<string[]> {
  const out: string[] = [];
  for (const c of CASES) if (c.fires.length > 0 && (await grade(c, fn)).length === 0) out.push(c.name);
  return out;
}

const OWNED_LOOP = "  for (const v of owned) refusals.push(`probe #63: ${v.message}`);\n";
const IN_WINDOW = "  const inWindow = violations.length > 0 && owned.length === 0 && rows.includes(debtRow);";
const ROW_EXCUSE = "!(inWindow && row === debtRow)";
const ROW_PUSH = "    if (row.includes(\": fail (\") && !(inWindow && row === debtRow)) refusals.push(row);";

describe("AC-STE-847.7 a mutated grade turns a named verdict test red", () => {
  test("control: the unmutated copy fires exactly what the table pins, case by case", async () => {
    const control = await mutantGrade("control", []);
    expect(await changedCases(control)).toEqual([]);
  });

  test("ignoring all of #63 accepts a corrupt stamp, so `rejects: #63 reports a corrupt stamp beside the debt` goes red", async () => {
    const fn = await mutantGrade("ignore-63", [
      [OWNED_LOOP, ""],
      [IN_WINDOW, '  const inWindow = rows.some((r) => r.startsWith("probe #63 ") && r.includes(": fail ("));'],
      [ROW_EXCUSE, '!(inWindow && row.startsWith("probe #63 "))'],
    ]);
    expect(await acceptedRejects(fn)).toEqual([
      "#63 reports a corrupt stamp without the debt",
      "#63 reports a corrupt stamp beside the debt",
      "#63 throws on a clean tree",
      "#63 throws on a debt tree",
      "#63 fails with no violation behind it",
      "#63 counts more than the debt",
    ]);
  });

  test("ignoring any single failing row accepts a lone #37 failure, so `rejects: another row fails, no window` goes red", async () => {
    const fn = await mutantGrade("ignore-one-row", [
      [IN_WINDOW, '  const inWindow = rows.filter((r) => r.includes(": fail (")).length === 1;'],
      [ROW_EXCUSE, "!inWindow"],
    ]);
    expect(await acceptedRejects(fn)).toEqual([
      "another row fails, no window",
      "another row throws",
      "#63 throws on a clean tree",
      "#63 throws on a debt tree",
      "#63 fails with no violation behind it",
      "#63 counts more than the debt",
    ]);
  });

  test("dropping the row loop keeps every verdict but changes what fires, so the table goes red", async () => {
    const fn = await mutantGrade("no-row-loop", [[ROW_PUSH, "    void row;"]]);
    expect(await acceptedRejects(fn)).toEqual([]);
    expect(await changedCases(fn)).toEqual(CASES.filter((c) => c.fires.some((f) => f.startsWith("row #"))).map((c) => c.name));
  });

  test("dropping the owned loop keeps every verdict but changes what fires, so the table goes red", async () => {
    const fn = await mutantGrade("no-owned-loop", [[OWNED_LOOP, ""]]);
    expect(await acceptedRejects(fn)).toEqual([]);
    expect(await changedCases(fn)).toEqual(CASES.filter((c) => c.fires.includes("owned")).map((c) => c.name));
  });
});

// ---------------------------------------------------------------------------
// AC-STE-847.6 — the probe is as strict as before
// ---------------------------------------------------------------------------

describe("AC-STE-847.6 probe #63 is unchanged", () => {
  test("the runner still fails the window at #63, severity error, exit 1", async () => {
    expect(GATE_PROBES.find((e) => e.n === 63)?.severity).toBe("error");
    const root = makeTree("debt");
    try {
      const out = await runGateProbes(root, base74());
      expect(out.rows).toContain("probe #63 plan_ship_coherence: fail (1)");
      expect(out.exitCode).toBe(1);
      expect(out.summary).toStartWith("conformance-probes pass: 73/74 [");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("the /gate-check registration still grades unshipped debt as an error", () => {
    const line = readFileSync(join(PLUGIN_ROOT, "skills", "gate-check", "SKILL.md"), "utf8").split("\n").find((l) => /^63\. /.test(l))!;
    expect(line).toContain("runPlanShipCoherenceProbe(projectRoot)");
    expect(line).toContain("**Severity: error");
  });
});
