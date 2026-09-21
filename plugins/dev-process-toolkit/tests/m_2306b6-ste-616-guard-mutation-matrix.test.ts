// STE-616 (M_2306b6) — the guard mutation matrix: every guard shown able to fail.
//
// Each row copies the plugin tree (tests/ excluded, adapters/ and templates/
// as real files, node_modules linked) to a unique temporary directory, applies
// ONE sited mutation with `mutateInRegion` (tests/_sited-mutation.ts), and runs
// `runScenario` for the (id, tracker) pairs the row names with `pluginRoot`
// set to the copy. A row is KILLED only when every named pair fails, each for
// the row's own reason (its `signature` matches the scenario's first failure),
// and no pair failed because a front door or the hook could not load.
//
// Outcomes a row can have, and what the suite does with each:
//   killed                  — pass;
//   not-killed              — a named pair stayed green (or failed for another
//                             reason): the row fails, naming it;
//   not-killed:load-error   — a subprocess died on a module-load, syntax or
//                             missing-file error: the row fails, naming it — a
//                             mutation that breaks the build is never read as a
//                             guard going red;
//   anchor-absent / anchor-duplicated — the row fails and is never counted.
//
// The unmutated copy must run every scenario green, and `git status
// --porcelain` over the plugin tree must be identical before and after: DPT
// is installed from this working tree, so the real tree is never mutated.
//
// Rows (u), (v), (w), (ag) and (ah) mutate toward OVER-refusal; each is killed
// by a permit case, which its signature names. The letter (k) is retired.

import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { mutateInRegion } from "./_sited-mutation";
import {
  Ctx,
  type ProcRun,
  type ScenarioResult,
  SCENARIO_DEFS,
  exitNonZeroBlocks,
  harnessBlocks,
  runScenario,
} from "./_shared_tracker_runner";
import { REAL_PLUGIN_ROOT, type Tracker, withSharedTrackerFixture } from "./_shared_tracker_fixture";

const PLUGIN_ROOT = REAL_PLUGIN_ROOT;
const REPO_ROOT = resolve(PLUGIN_ROOT, "..", "..");
const TESTS = join(PLUGIN_ROOT, "tests");
const REPO_NODE_MODULES = join(REPO_ROOT, "node_modules");
const KICKOFF = "230148c9";
const CONCURRENCY = 4;

const H = "templates/hooks/_lib/hooks/pre-tracker-write-gate.ts";
const S = "adapters/_shared/src";

type Pair = [string, Tracker];
const both = (id: string): Pair[] => [
  [id, "jira"],
  [id, "linear"],
];

export interface MatrixRow {
  row: string;
  guard: string;
  file: string;
  find: string;
  replace: string;
  pairs: Pair[];
  /** The first failure of every named pair must match this: the row's own reason. */
  signature: RegExp;
  /** The acceptance clauses this row turns red (AC-STE-616.23). */
  clauses: string[];
}

export const ROWS: MatrixRow[] = [
  { row: "a", guard: "the FR-create decision drops the repo-tag conjunct", file: `${S}/create_idempotency_probe.ts`, find: "return { mode, binding: { ...binding, project: binding.project } };", replace: "return { mode, binding: { ...binding, repoTag: undefined, project: binding.project } };", pairs: both("S2"), signature: /should create, got .*"reused"/, clauses: ["AC.5"] },
  { row: "b", guard: "the milestone decision reports act=create whatever the listing held", file: `${S}/resolve_milestone_identity.ts`, find: "const act = decision.act;", replace: 'const act = "create";', pairs: both("S3"), signature: /join by key prints act=/, clauses: ["AC.6"] },
  { row: "c", guard: "the mint binds a coincidental title match without an explicit join", file: `${S}/resolve_milestone_identity.ts`, find: 'if (decision.act === "join" && binding.shared && args.sibling === undefined) {', replace: 'if (decision.act === "join" && decision.via === "key" && binding.shared && args.sibling === undefined) {', pairs: both("S3"), signature: /coincident title with no join key must refuse/, clauses: ["AC.6"] },
  { row: "d", guard: "the tracker-write hook exits 0 before reading receipts", file: H, find: "  const note = unreadableInputsNote(payload, transcript, scan);", replace: "  return 0;\n  const note = unreadableInputsNote(payload, transcript, scan);", pairs: both("S7"), signature: /a create with no receipt: expected the hook to block/, clauses: ["AC.9"] },
  { row: "e", guard: "the hook reads receipts from the payload's cwd instead of the target repository", file: H, find: "    if (a.root !== target.root || !a.intact) continue;", replace: "    if (a.root !== declared[0]!.root || !a.intact) continue;", pairs: both("S9"), signature: /receipt sits only in A/, clauses: ["AC.9"] },
  { row: "f", guard: "the version-floor comparison is removed", file: H, find: "if (!v.ok) {", replace: "if (false && !v.ok) {", pairs: both("S6"), signature: /below the floor/, clauses: ["AC.9"] },
  { row: "g", guard: "the orphan listing drops its tag scope", file: `${S}/container_ownership.ts`, find: "const cls = classifyTicket(t, binding);", replace: "const cls = classifyTicket(t, { ...binding, shared: false });", pairs: both("S4"), signature: /class of the sibling's tagged ticket/, clauses: ["AC.7"] },
  { row: "h", guard: "the untagged-ticket detector treats a missing tag as present", file: `${S}/container_ownership.ts`, find: '? "sibling" : "unowned";', replace: '? "sibling" : "ours";', pairs: [...both("S4"), ...both("S13")], signature: /untagged ticket/, clauses: ["AC.7", "AC.17"] },
  { row: "i", guard: "readWorkspaceBinding drops repoTag", file: `${S}/workspace_binding.ts`, find: "  return { ...result, shared: result.repoTag !== undefined };", replace: "  delete result.repoTag;\n  return { ...result, shared: result.repoTag !== undefined };", pairs: both("S7"), signature: /a create with no receipt: expected the hook to block/, clauses: ["AC.9"] },
  { row: "j", guard: "the hook matcher names one MCP server only", file: "hooks/hooks.json", find: '"matcher": "^mcp__.+__(', replace: '"matcher": "^mcp__(atlassian|linear)__(', pairs: both("S7"), signature: /no registered matcher matched/, clauses: ["AC.11"] },
  { row: "l", guard: "the commit and PR hooks accept the session's own repository's evidence for a write into its sibling", file: `${S}/gate_receipt.ts`, find: "      : where.roots,", replace: "      : (own === null ? where.roots : [own]),", pairs: both("S12"), signature: /with only A's evidence must be refused/, clauses: ["AC.13"] },
  { row: "m", guard: "the sibling ship gate reads a busy sibling as idle", file: `${S}/sibling_release.ts`, find: 'const held = siblings.filter((s) => s.state !== "idle");', replace: 'const held = siblings.filter((s) => s.state !== "idle" && s.state !== "busy");', pairs: both("S5"), signature: /must be held/, clauses: ["AC.8"] },
  { row: "n", guard: "the repoint front door skips its old-container active-plan check", file: `${S}/repoint_tracker_binding.ts`, find: "else results.push(await decideRow7(args, containers.value));", replace: 'else results.push(row(7, "PASS", "old-container check skipped"));', pairs: both("S8"), signature: /active plan in its old container/, clauses: ["AC.12"] },
  { row: "o", guard: "the hook accepts a receipt from another session", file: H, find: "r.sessionId === sessionId && ", replace: "", pairs: both("S7"), signature: /JSON names another session/, clauses: ["AC.9"] },
  { row: "p", guard: "the hook skips comparing the tool input with what the receipt decided", file: H, find: "  const matching = seen.filter((r) => createMismatch(call.adapter, shape, r.shape, tag) === null);", replace: "  const matching = seen;", pairs: both("S7"), signature: /title differs from its receipt/, clauses: ["AC.9"] },
  { row: "q", guard: "the declaration reader treats an unreadable CLAUDE.md as undeclared", file: `${S}/workspace_binding.ts`, find: 'const code = (e as NodeJS.ErrnoException).code ?? "unknown";', replace: 'return { shared: false };\n    const code = (e as NodeJS.ErrnoException).code ?? "unknown";', pairs: both("S11"), signature: /CLAUDE\.md cannot be read/, clauses: ["AC.10"] },
  { row: "r", guard: "the hook's refusal exits 1 instead of 2", file: H, find: "process.exit(code satisfies 0 | 2);", replace: "process.exit(code === 2 ? 1 : code);", pairs: both("S7"), signature: /expected the hook to block the write \(exit 2\), got exit 1/, clauses: ["AC.9"] },
  { row: "s", guard: "the hook passes a create that names no project", file: H, find: 'if (shape.project === "" && shape.team === "") {', replace: 'if (shape.project === "" && shape.team === "") {\n    return 0;', pairs: both("S9"), signature: /naming no project/, clauses: ["AC.9"] },
  { row: "t", guard: "a front door takes the not-last page of a listing as complete (the milestone decision, Jira)", file: `${S}/resolve_milestone_identity.ts`, find: "if (!read.page.last) {", replace: "if (false) {", pairs: [["S3", "jira"]], signature: /not-last listing page must refuse/, clauses: ["AC.6"] },
  { row: "u", guard: "OVER-REFUSAL: the detector counts only its own repository's tag, so it flags the sibling's tickets", file: `${S}/container_ownership.ts`, find: "foreignLabels(ticket, binding).length > 0", replace: "false", pairs: both("S4"), signature: /class of the sibling's tagged ticket .*: expected "sibling", got "unowned"/, clauses: ["AC.7"] },
  { row: "v", guard: "OVER-REFUSAL: the sibling ship gate reads ANY active FR in the sibling as busy", file: `${S}/active_plan_ship_ready.ts`, find: "for (const id of idsBoundTo(rows, milestone)) {", replace: "for (const id of rows.map((row) => row.id)) {", pairs: both("S5"), signature: /different milestone token: A's release must pass/, clauses: ["AC.8"] },
  { row: "w", guard: "OVER-REFUSAL: the hook refuses a create made under a join receipt", file: H, find: 'if (act === "join") return null;', replace: 'if (act === "join") return NOT_CREATED;', pairs: both("S14"), signature: /the join path\): expected the hook to permit/, clauses: ["AC.9", "AC.18"] },
  { row: "x", guard: "the hook counts an import or adopt receipt whose consent question was declined", file: H, find: ".some((l) => l < a.line)) return true;", replace: ".length >= 0) return true;", pairs: both("S13"), signature: /with the question declined/, clauses: ["AC.17"] },
  { row: "y", guard: "the attach-target front door skips its provenance check", file: `${S}/attach_project_milestone.ts`, find: 'if (!binding.shared) return { kind: "unshared" };', replace: 'return { kind: "unshared" };', pairs: both("S14"), signature: /attach front door must refuse/, clauses: ["AC.18"] },
  { row: "z", guard: "the ownership decision drops its project comparison", file: `${S}/ticket_ownership.ts`, find: "if (binding.project !== undefined && project !== binding.project) {", replace: "if (false) {", pairs: both("S13"), signature: /other project's ticket .*expected "foreign-project"/, clauses: ["AC.17"] },
  { row: "aa", guard: "the detector drops the numeric-milestone-shared warning", file: `${S}/tracker_local_reconciliation_drift.ts`, find: "violations.push(...numericMilestoneShared(all, binding, bound));", replace: "void numericMilestoneShared;", pairs: [["S15", "jira"]], signature: /numeric-milestone-shared rows reported/, clauses: ["AC.19"] },
  { row: "ab", guard: "the typed-M<N> door answers verdict=free in tracker mode", file: `${S}/next_free_milestone_number.ts`, find: 'modeRefusal === null && (mode === "jira" || mode === "linear")', replace: "false", pairs: both("S16"), signature: /typed door for M999/, clauses: ["AC.20"] },
  { row: "ac", guard: "probe #73's mode: linear arm is skipped", file: `${S}/plan_identity_mode_conditional.ts`, find: 'mode === "linear" ? LINEAR_PROVENANCE_ARM : null', replace: 'mode === "linear" ? null : null', pairs: [["S16", "linear"]], signature: /rows for the hand-written M999\.md/, clauses: ["AC.20"] },
  { row: "ad", guard: "the recogniser reads merge, cherry-pick, revert, am and commit-tree as non-commits", file: `${S}/commit_target_repo.ts`, find: "if (row === null || subcommand === null) return null;", replace: 'if (row === null || subcommand === null || subcommand !== "commit") return null;', pairs: both("S17"), signature: /aimed at B with only A's evidence must exit 2/, clauses: ["AC.21"] },
  { row: "ae", guard: "the recogniser classifies an alias word without resolving it", file: `${S}/commit_target_repo.ts`, find: "name === null || GIT_COMMANDS.has(name)", replace: "name === null || true", pairs: both("S17"), signature: /alias .*aimed at B with only A's evidence must exit 2/, clauses: ["AC.21"] },
  { row: "af", guard: "the /tdd hook's Reminders exit 0 again", file: "templates/hooks/_lib/hooks/pre-commit-tdd-orchestrator.ts", find: "process.exit(1);", replace: "process.exit(0);", pairs: both("S18"), signature: /must exit 1 \(a visible Reminder, never a silent allow\)/, clauses: ["AC.22"] },
  { row: "ag", guard: "OVER-REFUSAL: the recogniser reads git merge --ff-only as a commit", file: `${S}/commit_target_repo.ts`, find: 'excludes: ["--ff-only", ', replace: "excludes: [", pairs: both("S17"), signature: /merge --ff-only writes no commit/, clauses: ["AC.21"] },
  { row: "ah", guard: "OVER-REFUSAL: the Linear arm dates a plan by its archive commit, so a pre-epoch archived plan fails", file: `${S}/plan_identity_mode_conditional.ts`, find: "`specs/plan/${token}.md`,", replace: "rel,", pairs: both("S16"), signature: /pre-epoch M8 plan/, clauses: ["AC.20"] },
  // Row (t)'s FR-create half, Jira: the door reads a final page that is not
  // the last as complete, so a decide fed only page 1 creates instead of
  // refusing `page-cap`. (Both trackers' pages now pass through one site, the
  // shared reader's `last`; this row is graded on its Jira pairs.)
  { row: "ai", guard: "the FR-create door takes a not-last page of its listing as complete (Jira)", file: `${S}/create_idempotency_probe.ts`, find: "return { items: r.items, capped: !r.last };", replace: "return { items: r.items, capped: false };", pairs: [["S1", "jira"], ["S2", "jira"]], signature: /from only the first page of its \d+-page listing/, clauses: ["AC.5"] },
];

const GUARD_CLAUSES = ["AC.5", "AC.6", "AC.7", "AC.8", "AC.9", "AC.10", "AC.11", "AC.12", "AC.13", "AC.17", "AC.18", "AC.19", "AC.20", "AC.21", "AC.22"];
const ROW_LETTERS = [..."abcdefghijlmnopqrstuvwxyz".split(""), "aa", "ab", "ac", "ad", "ae", "af", "ag", "ah", "ai"];
const OVER_REFUSAL = ["u", "v", "w", "ag", "ah"];

// ===========================================================================
// Copying and classifying
// ===========================================================================

function porcelain(): string {
  const p = spawnSync("git", ["-C", REPO_ROOT, "status", "--porcelain", "--untracked-files=all", "--", "plugins/dev-process-toolkit"], { encoding: "utf-8" });
  if (p.status !== 0) throw new Error(`git status failed: ${p.stderr}`);
  return p.stdout;
}
const PORCELAIN_BEFORE = porcelain();
const COPIES: string[] = [];

/** Copy the plugin tree (tests/ excluded) with real files; link node_modules. */
export function copyPluginTree(label: string, from = PLUGIN_ROOT): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `dpt-ste616-matrix-${label}-`)));
  COPIES.push(dir);
  const copy = join(dir, "plugin");
  cpSync(from, copy, {
    recursive: true,
    filter: (src) => src !== join(from, "tests") && !src.startsWith(`${join(from, "tests")}/`) && basename(src) !== "node_modules",
  });
  if (existsSync(REPO_NODE_MODULES)) symlinkSync(REPO_NODE_MODULES, join(copy, "node_modules"), "dir");
  return copy;
}

function symlinksUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      const st = lstatSync(p);
      if (st.isSymbolicLink()) out.push(p);
      else if (st.isDirectory()) walk(p);
    }
  };
  walk(dir);
  return out;
}

export type RowOutcome =
  | { kind: "killed"; detail: string[] }
  | { kind: "not-killed"; detail: string[] }
  | { kind: "not-killed:load-error"; detail: string[] }
  | { kind: "anchor-absent"; detail: string[] }
  | { kind: "anchor-duplicated"; detail: string[] }
  | { kind: "error"; detail: string[] };

/** The outcome of applying a row: a thrown anchor error is named, never counted as killed. */
export function anchorOutcome(e: unknown): RowOutcome {
  const msg = (e as Error)?.message ?? String(e);
  if (/ABSENT/.test(msg)) return { kind: "anchor-absent", detail: [msg] };
  if (/occurs \d+ times/.test(msg)) return { kind: "anchor-duplicated", detail: [msg] };
  return { kind: "error", detail: [msg] };
}

/** Classify a row's scenario results. */
export function classifyRow(signature: RegExp, results: ReadonlyArray<Pick<ScenarioResult, "id" | "tracker" | "ok" | "failures" | "loadErrors">>): RowOutcome {
  const loads = results.filter((r) => r.loadErrors.length > 0);
  if (loads.length > 0) return { kind: "not-killed:load-error", detail: loads.map((r) => `${r.id} ${r.tracker}: ${r.loadErrors[0]}`) };
  const survived = results.filter((r) => r.ok);
  if (survived.length > 0 || results.length === 0) {
    return { kind: "not-killed", detail: results.length === 0 ? ["the row names no scenario"] : survived.map((r) => `${r.id} ${r.tracker} stayed green`) };
  }
  const offReason = results.filter((r) => !signature.test(r.failures[0] ?? ""));
  if (offReason.length > 0) {
    return { kind: "not-killed", detail: offReason.map((r) => `${r.id} ${r.tracker} failed for another reason: ${r.failures[0]}`) };
  }
  return { kind: "killed", detail: results.map((r) => `${r.id} ${r.tracker}: ${r.failures[0]!.split("\n")[0]}`) };
}

async function runRow(row: MatrixRow): Promise<RowOutcome> {
  const copy = copyPluginTree(`row-${row.row}`);
  try {
    const path = join(copy, row.file);
    const doc = readFileSync(path, "utf-8");
    let mutated: string;
    try {
      mutated = mutateInRegion(doc, 0, doc.length, row.find, row.replace, { label: `row (${row.row}) ${row.file}` });
    } catch (e) {
      return anchorOutcome(e);
    }
    writeFileSync(path, mutated);
    const results: ScenarioResult[] = [];
    for (const [id, tracker] of row.pairs) results.push(await runScenario(id, tracker, { pluginRoot: copy }));
    return classifyRow(row.signature, results);
  } finally {
    rmSync(resolve(copy, ".."), { recursive: true, force: true });
  }
}

async function bounded<T, R>(items: readonly T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

afterAll(() => {
  for (const d of COPIES) rmSync(d, { recursive: true, force: true });
});

// ===========================================================================
// The table itself (AC-STE-616.15 / .23)
// ===========================================================================

describe("AC-STE-616.15 / .23 — the row table", () => {
  test("rows (a) to (z) and (aa) to (ai) are present exactly once, (k) retired, each naming at least one scenario of the runner", () => {
    expect(ROWS.map((r) => r.row)).toEqual(ROW_LETTERS);
    expect(ROWS.some((r) => r.row === "k")).toBe(false);
    for (const r of ROWS) {
      expect({ row: r.row, pairs: r.pairs.length > 0 }).toEqual({ row: r.row, pairs: true });
      for (const [id, t] of r.pairs) expect({ row: r.row, id, t, known: SCENARIO_DEFS[id]?.trackers.includes(t) ?? false }).toEqual({ row: r.row, id, t, known: true });
    }
  });
  test("every guard clause (AC.5-13, AC.17-22) is named by at least one row, and every row by at least one clause", () => {
    for (const c of GUARD_CLAUSES) expect({ clause: c, rows: ROWS.filter((r) => r.clauses.includes(c)).length > 0 }).toEqual({ clause: c, rows: true });
    for (const r of ROWS) expect({ row: r.row, clauses: r.clauses.length > 0 && r.clauses.every((c) => GUARD_CLAUSES.includes(c)) }).toEqual({ row: r.row, clauses: true });
  });
  test("the over-refusal rows (u), (v), (w), (ag), (ah) are each killed by a permit case", () => {
    const permit = /must pass|permit|writes no commit|pre-epoch|expected "sibling"/;
    for (const letter of OVER_REFUSAL) {
      const r = ROWS.find((x) => x.row === letter)!;
      expect({ row: letter, over: r.guard.startsWith("OVER-REFUSAL"), permit: permit.test(r.signature.source) }).toEqual({ row: letter, over: true, permit: true });
    }
  });
});

describe("AC-STE-616.15 — the classifier, with its negative controls", () => {
  const green = { id: "S7", tracker: "jira" as const, ok: true, failures: [], loadErrors: [] };
  const red = (msg: string, loadErrors: string[] = []) => ({ id: "S7", tracker: "jira" as const, ok: false, failures: [msg], loadErrors });
  test("CONTROL — named scenarios that all stay green fail the row as not-killed", () => {
    expect(classifyRow(/x/, [green]).kind).toBe("not-killed");
    expect(classifyRow(/x/, [red("x failed"), green]).kind).toBe("not-killed");
    expect(classifyRow(/x/, []).kind).toBe("not-killed");
  });
  test("CONTROL — a scenario failing on a load error is not-killed:load-error, never killed", () => {
    expect(classifyRow(/x/, [red("x failed", ["pre-tracker-write-gate.sh: exit 1: SyntaxError: Unexpected token"])]).kind).toBe("not-killed:load-error");
  });
  test("CONTROL — a scenario failing for a reason other than the row's own is not killed", () => {
    expect(classifyRow(/below the floor/, [red("attach failed: something else")]).kind).toBe("not-killed");
    expect(classifyRow(/below the floor/, [red("running 1.0.0 below the floor 2.0.0: expected ...")]).kind).toBe("killed");
  });
  test("CONTROL — an absent anchor and a duplicated anchor are named row failures, never killed", () => {
    let absent: unknown;
    try {
      mutateInRegion("const a = 1;\n", 0, 13, "const b = 2;", "x", { label: "control" });
    } catch (e) {
      absent = e;
    }
    expect(anchorOutcome(absent).kind).toBe("anchor-absent");
    let dup: unknown;
    try {
      mutateInRegion("x;\nx;\n", 0, 6, "x;", "y;", { label: "control" });
    } catch (e) {
      dup = e;
    }
    expect(anchorOutcome(dup).kind).toBe("anchor-duplicated");
  });
  test("CONTROL — a mutation that breaks the hook's build is classified not-killed:load-error through the real runner", async () => {
    const copy = copyPluginTree("load-error");
    const path = join(copy, H);
    const doc = readFileSync(path, "utf-8");
    writeFileSync(path, mutateInRegion(doc, 0, doc.length, "process.exit(code satisfies 0 | 2);", "process.exit(code satisfies 0 | 2) ((((;", { label: "load-error control" }));
    const r = await runScenario("S7", "jira", { pluginRoot: copy });
    const outcome = classifyRow(/a create with no receipt/, [r]);
    expect(outcome.kind, JSON.stringify(outcome.detail)).toBe("not-killed:load-error");
  }, 240_000);
  test("CONTROL — a runner that treats exit 1 as a block misreads row (r): the refusal-by-exit-1 never reaches the double", async () => {
    const copy = copyPluginTree("harness-control");
    const r = ROWS.find((x) => x.row === "r")!;
    const path = join(copy, r.file);
    const doc = readFileSync(path, "utf-8");
    writeFileSync(path, mutateInRegion(doc, 0, doc.length, r.find, r.replace, { label: "row (r) control" }));
    const right = await runScenario("S7", "jira", { pluginRoot: copy });
    const kind = await runScenario("S7", "jira", { pluginRoot: copy, blockRule: exitNonZeroBlocks });
    expect(right.failures[0] ?? "", "with the harness rule, the exit-1 refusal reaches the double").toMatch(/the write reached the double/);
    expect(kind.failures[0] ?? "", "with the kind rule, the same write reads as blocked").not.toMatch(/the write reached the double/);
  }, 240_000);
});

// ===========================================================================
// The baseline and the rows
// ===========================================================================

const ALL_PAIRS: Pair[] = Object.entries(SCENARIO_DEFS).flatMap(([id, d]) => d.trackers.map((t) => [id, t] as Pair));
const OUTCOMES = new Map<string, RowOutcome>();

describe("AC-STE-616.15 — the unmutated copy runs every scenario green", () => {
  test("the copy holds adapters/ and templates/ as real files, with tests/ excluded", () => {
    const copy = copyPluginTree("shape");
    expect(existsSync(join(copy, "tests")), "tests/ is excluded from the copy").toBe(false);
    expect(symlinksUnder(join(copy, "adapters")), "adapters/ holds no symlink").toEqual([]);
    expect(symlinksUnder(join(copy, "templates")), "templates/ holds no symlink").toEqual([]);
    rmSync(resolve(copy, ".."), { recursive: true, force: true });
  });
  test("baseline: every scenario of every tracker is green against the unmutated copy", async () => {
    const copy = copyPluginTree("baseline");
    const results = await bounded(ALL_PAIRS, CONCURRENCY, ([id, t]) => runScenario(id, t, { pluginRoot: copy }));
    const red = results.filter((r) => !r.ok).map((r) => `${r.id} ${r.tracker}: ${r.failures[0]}`);
    expect(red).toEqual([]);
  }, 900_000);
});

describe("AC-STE-616.15 — every row reds its named scenarios", () => {
  test("the matrix runs (every row, against its own mutated copy)", async () => {
    const outcomes = await bounded(ROWS, CONCURRENCY, (r) => runRow(r));
    ROWS.forEach((r, i) => OUTCOMES.set(r.row, outcomes[i]!));
    expect(OUTCOMES.size).toBe(ROWS.length);
  }, 1_800_000);

  for (const r of ROWS) {
    test(`row (${r.row}) — ${r.guard} — reds ${r.pairs.map((p) => p.join(" ")).join(", ")}`, () => {
      const o = OUTCOMES.get(r.row);
      expect(o, `row (${r.row}) was not run`).toBeDefined();
      expect({ row: r.row, outcome: o!.kind, detail: o!.kind === "killed" ? [] : o!.detail }).toEqual({ row: r.row, outcome: "killed", detail: [] });
    });
  }
});

// ===========================================================================
// Shown red on the pre-fix bytes (AC-STE-616.7 / .13)
// ===========================================================================

/** A copy whose adapters/ and templates/ are the kickoff commit's bytes. */
function kickoffCopy(label: string): string {
  const copy = copyPluginTree(label);
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "dpt-ste616-kickoff-")));
  COPIES.push(dir);
  const arch = spawnSync("bash", ["-c", `git -C "${REPO_ROOT}" archive ${KICKOFF} plugins/dev-process-toolkit/adapters plugins/dev-process-toolkit/templates | tar -x -C "${dir}"`], { encoding: "utf-8" });
  if (arch.status !== 0) throw new Error(`git archive ${KICKOFF} failed: ${arch.stderr}`);
  for (const sub of ["adapters", "templates"]) {
    rmSync(join(copy, sub), { recursive: true, force: true });
    cpSync(join(dir, "plugins", "dev-process-toolkit", sub), join(copy, sub), { recursive: true });
  }
  return copy;
}

describe("the two fixes this FR makes are red on the pre-fix bytes", () => {
  test(`AC-STE-616.7 — S4 against the kickoff (${KICKOFF}) detector goes red on the page-naming refusal`, async () => {
    const copy = kickoffCopy("prefix-ac7");
    for (const t of ["jira", "linear"] as const) {
      const r = await runScenario("S4", t, { pluginRoot: copy });
      expect(r.loadErrors, `S4 ${t}`).toEqual([]);
      expect(r.ok, `S4 ${t} must be red on the pre-fix bytes`).toBe(false);
      expect(r.failures[0] ?? "", `S4 ${t}`).toMatch(/must name the page|must refuse \(non-zero exit\)|must be a refusal|must not read as partial/);
    }
  }, 240_000);
  test(`AC-STE-616.13 — S12 against the kickoff (${KICKOFF}) commit and PR hooks goes red on the unreadable declaration`, async () => {
    const copy = kickoffCopy("prefix-ac13");
    for (const t of ["jira", "linear"] as const) {
      const r = await runScenario("S12", t, { pluginRoot: copy });
      expect(r.loadErrors, `S12 ${t}`).toEqual([]);
      expect(r.ok, `S12 ${t} must be red on the pre-fix bytes`).toBe(false);
      expect(r.failures[0] ?? "", `S12 ${t}`).toMatch(/CLAUDE\.md cannot be read must be refused/);
    }
  }, 240_000);
});

// ---------------------------------------------------------------------------
// AC-STE-616.7 pre-fix proofs, each its own test: the detector CLI spawned
// directly (never through S4's stop-at-first-failure), from the kickoff bytes
// and from the current tree, over the SAME page files.
// ---------------------------------------------------------------------------

let KICKOFF_CLI_COPY: string | null = null;
function kickoffCliCopy(): string {
  KICKOFF_CLI_COPY ??= kickoffCopy("prefix-cli");
  return KICKOFF_CLI_COPY;
}

const DETECTOR = `${S}/tracker_local_reconciliation_drift.ts`;

interface Ac7Listing {
  root: string;
  multi: string[];
  errorBody: string;
  untagged: string;
  tagged: string[];
  detect(pluginRoot: string, pages: string[]): Promise<ProcRun>;
}

/** A shared container with two tickets per repository and one untagged ticket, listed at page size 2. */
async function withAc7Listing(tracker: Tracker, body: (l: Ac7Listing) => Promise<void>): Promise<void> {
  await withSharedTrackerFixture({ tracker, shape: "coexist" }, async (fx) => {
    const ctx = new Ctx(fx, PLUGIN_ROOT, harnessBlocks);
    const tagged = [
      ...[1, 2].map((n) => ctx.seedTicket({ title: `A work ${n}`, labels: [fx.a.tag], container: fx.a.milestone })),
      ...[1, 2].map((n) => ctx.seedTicket({ title: `B work ${n}`, labels: [fx.b.tag], container: fx.b.milestone })),
    ];
    const untagged = ctx.seedTicket({ title: "Filed by hand", labels: [] });
    fx.double.pageSize = 2;
    const multi = ctx.containerPages();
    fx.double.pageSize = null;
    const errorBody = ctx.file("transport-error.json", tracker === "jira" ? { errorMessages: ["Internal server error"], errors: {} } : { error: "fetch failed: socket hang up" });
    await body({
      root: fx.a.root,
      multi,
      errorBody,
      untagged,
      tagged,
      detect: (pluginRoot, pages) => ctx.door(DETECTOR, [fx.a.root, ...pages], { kind: "detector", pluginRoot }),
    });
  });
}

const pageIsLastOnDisk = (tracker: Tracker, path: string): boolean => {
  const p = JSON.parse(readFileSync(path, "utf-8"));
  // The measured shapes: a plain Jira page's `isLast` (the matrix runs the
  // plain double), a Linear page's top-level `hasNextPage`.
  return tracker === "jira" ? p.isLast === true : p.hasNextPage === false;
};

describe("AC-STE-616.7 — the detector fixes, each red on the kickoff bytes (CLI spawned directly)", () => {
  test(`AC-STE-616.7 pre-fix (a) — pages = [page 1 of a multi-page listing, not the last]: kickoff (${KICKOFF}) exits 0 (Jira: "warning container-partial"; Linear: graded silently); current exits 1 naming that page`, async () => {
    for (const t of ["jira", "linear"] as const) {
      await withAc7Listing(t, async (l) => {
        expect(l.multi.length, `${t}: the forced listing spans >= 2 pages`).toBeGreaterThanOrEqual(2);
        expect(pageIsLastOnDisk(t, l.multi[0]!), `${t}: page 1 is not the last`).toBe(false);
        const kick = await l.detect(kickoffCliCopy(), [l.multi[0]!]);
        expect(kick.stderr, `${t} kickoff: no load error`).not.toMatch(/SyntaxError|Cannot find module/);
        // On the MEASURED Linear page (top-level `hasNextPage`, no `pageInfo`)
        // the kickoff's fail-open pageIsLast reads page 1 as the last page, so
        // it grades the incomplete listing silently: exit 0 with no partial
        // row at all — the same defect, worse than the warning the invented
        // `pageInfo` page used to draw. The Jira kickoff still warns.
        const kickoffWarns = t === "jira";
        expect({ exit: kick.exitCode, warning: /^warning container-partial:/m.test(kick.stdout) }, `${t} kickoff:\n${kick.stdout}${kick.stderr}`).toEqual({ exit: 0, warning: kickoffWarns });
        const now = await l.detect(PLUGIN_ROOT, [l.multi[0]!]);
        expect(now.exitCode, `${t} current:\n${now.stdout}${now.stderr}`).toBe(1);
        expect(now.stdout).toContain(`error container-partial: ${l.multi[0]} `);
        expect(now.stdout).not.toMatch(/^warning container-partial/m);
      });
    }
  }, 240_000);

  test(`AC-STE-616.7 pre-fix (b) — pages = [every page of a complete multi-page listing; only the final page is last]: kickoff (${KICKOFF}) reports container-partial on Jira (false drift); current exits 0 and flags only the untagged ticket`, async () => {
    for (const t of ["jira", "linear"] as const) {
      await withAc7Listing(t, async (l) => {
        expect(l.multi.length, `${t}: the forced listing spans >= 2 pages`).toBeGreaterThanOrEqual(2);
        expect(l.multi.map((p) => pageIsLastOnDisk(t, p)), `${t}: earlier pages not last, the final page last`).toEqual([...l.multi.slice(0, -1).map(() => false), true]);
        const kick = await l.detect(kickoffCliCopy(), l.multi);
        expect(kick.stderr, `${t} kickoff: no load error`).not.toMatch(/SyntaxError|Cannot find module/);
        // The false drift is a Jira fact on the measured pages: the kickoff's
        // Linear pageIsLast reads every measured page (no `pageInfo`) as last,
        // so it cannot read a complete Linear listing as partial — its Linear
        // defect is the silent pass pre-fix (a) grades.
        expect(/container-partial/.test(kick.stdout), `${t} kickoff reads the complete listing as partial:\n${kick.stdout}`).toBe(t === "jira");
        const now = await l.detect(PLUGIN_ROOT, l.multi);
        expect(now.exitCode, `${t} current:\n${now.stdout}${now.stderr}`).toBe(0);
        expect(now.stdout).not.toContain("container-partial");
        const flagged = now.stdout.split("\n").filter((x) => /^(warning|error) (unowned-container-ticket|bound-ticket-untagged):/.test(x));
        expect(flagged.map((x) => /: (\S+) /.exec(x)?.[1]), `${t} current flags exactly the untagged ticket`).toEqual([l.untagged]);
        for (const k of l.tagged) expect(flagged.some((x) => new RegExp(`\\b${k}\\b`).test(x)), `${t}: tagged ${k} flagged`).toBe(false);
      });
    }
  }, 240_000);

  test(`AC-STE-616.7 pre-fix (c) — pages = [page 1, then a transport-error body]: kickoff (${KICKOFF}) refuses without naming the page; current refuses naming it`, async () => {
    for (const t of ["jira", "linear"] as const) {
      await withAc7Listing(t, async (l) => {
        const set = [l.multi[0]!, l.errorBody];
        const kick = await l.detect(kickoffCliCopy(), set);
        expect(kick.stderr, `${t} kickoff: no load error`).not.toMatch(/SyntaxError|Cannot find module/);
        expect(kick.exitCode, `${t} kickoff refuses`).not.toBe(0);
        expect(`${kick.stdout}${kick.stderr}`.includes(l.errorBody), `${t} kickoff's refusal does not name ${l.errorBody}:\n${kick.stdout}${kick.stderr}`).toBe(false);
        const now = await l.detect(PLUGIN_ROOT, set);
        expect(now.exitCode, `${t} current:\n${now.stdout}${now.stderr}`).toBe(1);
        expect(now.stdout).toContain(`error container-unreadable: ${l.errorBody}: `);
      });
    }
  }, 240_000);
});

// ---------------------------------------------------------------------------
// AC-STE-616.13 pre-fix proofs, each leg its own test: B's CLAUDE.md present
// but unreadable, a session rooted in A holding only A's evidence.
// ---------------------------------------------------------------------------

async function withUnreadableDeclaration(
  tracker: Tracker,
  which: "pre-commit-gate-check" | "pre-pr-spec-review",
  body: (kick: ProcRun, now: ProcRun, md: string) => void,
): Promise<void> {
  const kickRoot = kickoffCliCopy();
  await withSharedTrackerFixture({ tracker, shape: "coexist" }, async (fx) => {
    const now = new Ctx(fx, PLUGIN_ROOT, harnessBlocks);
    const kick = new Ctx(fx, kickRoot, harnessBlocks);
    const skill = which === "pre-commit-gate-check" ? "gate-check" : "spec-review";
    const s = now.session(`prefix-${skill}`);
    now.evidenceWindow(s, skill, [await now.gateReceipt(fx.a.root, skill, s)], skill);
    const command = which === "pre-commit-gate-check" ? `git -C ${fx.b.root} commit -m x` : `cd ${fx.b.root} && gh pr create --title x --body y`;
    const md = join(fx.b.root, "CLAUDE.md");
    chmodSync(md, 0o000);
    let rk: ProcRun;
    let rn: ProcRun;
    try {
      rk = await kick.commitHook(which, command, { session: s, cwd: fx.a.root });
      rn = await now.commitHook(which, command, { session: s, cwd: fx.a.root });
    } finally {
      chmodSync(md, 0o644);
    }
    body(rk, rn, md);
  });
}

describe("AC-STE-616.13 — the unreadable-declaration fix, each leg red on the kickoff bytes", () => {
  for (const [leg, which] of [
    ["the commit leg (pre-commit-gate-check)", "pre-commit-gate-check"],
    ["the PR leg (pre-pr-spec-review)", "pre-pr-spec-review"],
  ] as const) {
    test(`AC-STE-616.13 pre-fix — ${leg}, B's CLAUDE.md unreadable, only A's evidence: kickoff (${KICKOFF}) lets it through (exit 0); current refuses (exit 2) naming the unreadable declaration`, async () => {
      for (const t of ["jira", "linear"] as const) {
        await withUnreadableDeclaration(t, which, (kick, now) => {
          expect(kick.stderr, `${t} kickoff: no load error`).not.toMatch(/SyntaxError|Cannot find module/);
          expect(kick.exitCode, `${t} kickoff ${leg} reads the unreadable CLAUDE.md as unmanaged:\n${kick.stderr}`).toBe(0);
          expect(now.exitCode, `${t} current ${leg}:\n${now.stderr}`).toBe(2);
          expect(now.stderr).toMatch(/CLAUDE\.md/);
          expect(now.stderr).toMatch(/unreadable|cannot be read|could not be read/i);
        });
      }
    }, 240_000);
  }
});

// ===========================================================================
// The real tree is never mutated
// ===========================================================================

describe("AC-STE-616.15 — the plugin tree is untouched", () => {
  test("git status --porcelain over the plugin tree is identical before and after the suite", () => {
    expect(porcelain()).toBe(PORCELAIN_BEFORE);
  });
});
