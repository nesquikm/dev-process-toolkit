// STE-730 (M_b2fdc0) — shared fixture for the declared-test-command suites.
//
// Not a test file (no `.test.ts` suffix): the main suite
// (`m_b2fdc0-ste-730-declared-capture.test.ts`) and the mutation battery
// (`m_b2fdc0-ste-730-mutation.test.ts`) both drive the LEGS below, the main
// suite against the shipped `adapters/_shared/src`, the battery against a
// mutated copy. One definition, so the battery cannot grade a leg the main
// suite does not run.
//
// HOW A RUN IS OBSERVED. Every fixture project is a temp directory with a
// `specs/settings.yaml` and a stack marker. The runners are FAKE scripts in a
// private bin directory prepended to the child's PATH: each one appends one
// line to `<bin>/calls.log` — its name, its argv (tab-separated) and its
// physical cwd — and prints a recorded runner summary. The front doors are run
// as subprocesses through `process.execPath` (an absolute path), so a fake
// `bun` on PATH never runs the front door itself, only the gate.
//
// The call log lives in the bin directory, OUTSIDE the project, so logging a
// call can never dirty the tree the skip-baseline capture judges.
//
// All names are synthetic.

import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { DPT_GITIGNORE_BODY } from "../adapters/_shared/src/setup/dpt_gitignore";

export const PLUGIN_ROOT = resolve(import.meta.dir, "..");
export const SHIPPED_SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src");

export const TOTALS_RE = /^gate_capture: pass (\d+), fail (\d+), skip (\d+)$/;

// ------------------------------------------------------------------ temps

const TEMPS: string[] = [];

export function tempDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `ste730-${label}-`));
  TEMPS.push(dir);
  return dir;
}

export function cleanupTemps(): void {
  for (const d of TEMPS.splice(0)) rmSync(d, { recursive: true, force: true });
}

// ------------------------------------------------------------------ settings

export interface TestCommandEntry {
  readonly stack: string;
  readonly command: readonly string[];
}

/**
 * A minimal valid settings file. `testCommands` undefined → the key is ABSENT
 * (the `verification` section is still present, so "absent" means the one key,
 * not the whole section). Any other value is written verbatim as JSON flow
 * YAML, so malformed shapes can be planted.
 */
export function settingsYaml(testCommands?: unknown): string {
  const verification: Record<string, unknown> = { verify_mode: "advisory" };
  if (testCommands !== undefined) verification.test_commands = testCommands;
  return [
    "schema_version: 1",
    'min_dpt_version: "3.0.0"',
    `task_tracking: ${JSON.stringify({ mode: "none" })}`,
    `verification: ${JSON.stringify(verification)}`,
    "",
  ].join("\n");
}

// ------------------------------------------------------------------ fake runners

export interface FakeRunner {
  /** Executable name (`fvm`, `flutter`, `make`, `bun`, `python3`). */
  readonly name: string;
  /** Lines printed when no `byArg` case matches. */
  readonly out?: readonly string[];
  /** Lines printed when `$1` equals the key. */
  readonly byArg?: Readonly<Record<string, readonly string[]>>;
  /** `$1` values that, after printing, `exec sleep 30` (to be killed on the bound). */
  readonly sleepOn?: readonly string[];
  readonly exitCode?: number;
  /** Copied to any `--reporter-outfile=<path>` argument. */
  readonly report?: string;
}

export interface FakeBin {
  readonly dir: string;
  calls(): FakeCall[];
  reset(): void;
}

export interface FakeCall {
  readonly name: string;
  readonly args: string[];
  readonly cwd: string;
}

function sq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function makeBin(label: string, runners: readonly FakeRunner[]): FakeBin {
  const dir = tempDir(`bin-${label}`);
  const log = join(dir, "calls.log");
  for (const r of runners) {
    const outFile = (key: string) => join(dir, `${r.name}.${key}.out`);
    const write = (key: string, lines: readonly string[]) => writeFileSync(outFile(key), lines.map((l) => `${l}\n`).join(""));
    write("default", r.out ?? []);
    const cases: string[] = [];
    for (const [arg, lines] of Object.entries(r.byArg ?? {})) {
      write(`case-${arg}`, lines);
      const tail = (r.sleepOn ?? []).includes(arg) ? "exec sleep 30" : `exit ${r.exitCode ?? 0}`;
      cases.push(`  ${sq(arg)}) cat ${sq(outFile(`case-${arg}`))}; ${tail} ;;`);
    }
    const reportFile = join(dir, `${r.name}.report`);
    if (r.report !== undefined) writeFileSync(reportFile, r.report);
    const script = [
      "#!/bin/sh",
      `{ printf '%s' ${sq(r.name)}; for a in "$@"; do printf '\\t%s' "$a"; done; printf '\\t@%s\\n' "$(pwd -P)"; } >> ${sq(log)}`,
      'rep=""',
      'for a in "$@"; do case "$a" in --reporter-outfile=*) rep="${a#--reporter-outfile=}" ;; esac; done',
      r.report === undefined ? ":" : `if [ -n "$rep" ]; then cp ${sq(reportFile)} "$rep"; fi`,
      'case "$1" in',
      ...cases,
      "  *) ;;",
      "esac",
      `cat ${sq(outFile("default"))}`,
      `exit ${r.exitCode ?? 0}`,
      "",
    ].join("\n");
    const path = join(dir, r.name);
    writeFileSync(path, script);
    chmodSync(path, 0o755);
  }
  return {
    dir,
    calls: () => {
      if (!existsSync(log)) return [];
      return readFileSync(log, "utf-8")
        .split("\n")
        .filter((l) => l.length > 0)
        .map((l) => {
          const parts = l.split("\t");
          const last = parts[parts.length - 1] ?? "";
          return { name: parts[0] ?? "", args: parts.slice(1, -1), cwd: last.replace(/^@/, "") };
        });
    },
    reset: () => rmSync(log, { force: true }),
  };
}

// ------------------------------------------------------------------ projects

export interface ProjectOpts {
  /** Stack marker file written at the root (e.g. `pubspec.yaml`). */
  readonly marker: string;
  /** settings.yaml body; `null` → no settings file at all. */
  readonly settings: string | null;
  /** Extra files, relative to the root. */
  readonly files?: Readonly<Record<string, string>>;
  /** Make it a clean git repo standing on `main` with the shipped `.dpt/.gitignore`. */
  readonly git?: boolean;
}

function git(cwd: string, args: string[]): string {
  const p = Bun.spawnSync(
    ["git", "-c", "user.email=t@t.test", "-c", "user.name=t", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args],
    { cwd, stdout: "pipe", stderr: "pipe" },
  );
  if (p.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${p.stderr.toString()}`);
  return p.stdout.toString().trim();
}

export function makeProject(label: string, opts: ProjectOpts): string {
  const root = realpathSync(tempDir(`proj-${label}`));
  const files: Record<string, string> = { [opts.marker]: opts.marker.endsWith(".json") ? '{"name":"ste730","private":true}\n' : "# synthetic\n", ...(opts.files ?? {}) };
  if (opts.settings !== null) files["specs/settings.yaml"] = opts.settings;
  if (opts.git) files[".dpt/.gitignore"] = DPT_GITIGNORE_BODY;
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  if (opts.git) {
    git(root, ["init", "-q", "-b", "main"]);
    git(root, ["add", "-A"]);
    git(root, ["commit", "-q", "-m", "chore: fixture"]);
  }
  return root;
}

// ------------------------------------------------------------------ front doors

export interface DoorRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

function runDoor(srcRoot: string, module: string, root: string, bin: FakeBin, env: Record<string, string> = {}): DoorRun {
  const childEnv: Record<string, string | undefined> = { ...process.env, PATH: `${bin.dir}:${process.env.PATH ?? ""}`, ...env };
  if (!("DPT_GATE_TIMEOUT_MS" in env)) delete childEnv.DPT_GATE_TIMEOUT_MS;
  if (!("DPT_GATE_KILL_GRACE_MS" in env)) delete childEnv.DPT_GATE_KILL_GRACE_MS;
  const p = Bun.spawnSync([process.execPath, join(srcRoot, module), root], {
    cwd: root,
    env: childEnv,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 120_000,
  });
  return { exitCode: p.exitCode ?? -1, stdout: p.stdout.toString(), stderr: p.stderr.toString() };
}

export function runGateCapture(srcRoot: string, root: string, bin: FakeBin, env?: Record<string, string>): DoorRun {
  return runDoor(srcRoot, "gate_capture.ts", root, bin, env);
}

export function runBaselineCapture(srcRoot: string, root: string, bin: FakeBin, env?: Record<string, string>): DoorRun {
  return runDoor(srcRoot, "capture_skip_baseline.ts", root, bin, env);
}

export function show(r: DoorRun): string {
  return `exit ${r.exitCode}\n--- stdout\n${r.stdout}--- stderr\n${r.stderr}`;
}

export function totalsLines(r: DoorRun): string[] {
  return r.stdout.split("\n").filter((l) => l.startsWith("gate_capture: pass ") || l.startsWith("gate_capture: totals"));
}

export const STORE_REL = join(".dpt", "skip-baseline.json");

/** The one baseline record in the project's store, or null when no store exists. */
export function baselineRecord(root: string): Record<string, unknown> | null {
  const path = join(root, STORE_REL);
  if (!existsSync(path)) return null;
  const store = JSON.parse(readFileSync(path, "utf-8")) as { baselines?: Record<string, Record<string, unknown>> };
  const records = Object.values(store.baselines ?? {});
  return records.length === 1 ? (records[0] ?? null) : { __records: records.length };
}

// ------------------------------------------------------------------ recorded outputs

/** `flutter test` summary: 5 passed, 1 skipped. */
export const FLUTTER_SUMMARY = ["00:01 +5 ~1: All tests passed!"];
/** What the bare `flutter` prints — different numbers, so its run would show. */
export const BARE_FLUTTER_SUMMARY = ["00:01 +99: All tests passed!"];
/** `make test-api` — pytest: 3 passed, 1 failed, 2 skipped. */
export const API_SUMMARY = ["============ 1 failed, 3 passed, 2 skipped in 0.10s ============"];
/** `make test-worker` — pytest: 4 passed, 1 skipped. */
export const WORKER_SUMMARY = ["============ 4 passed, 1 skipped in 0.10s ============"];
/** The table's bare `python3 -m pytest` — different numbers again. */
export const TABLE_PYTEST_SUMMARY = ["============ 1 failed, 3 passed, 2 skipped in 0.01s ============"];
export const NO_COUNT = ["make: the runner printed nothing countable"];

export const MAKE_ENTRIES: TestCommandEntry[] = [
  { stack: "pytest", command: ["make", "test-api"] },
  { stack: "pytest", command: ["make", "test-worker"] },
];
export const FVM_ENTRY: TestCommandEntry[] = [{ stack: "flutter", command: ["fvm", "flutter", "test"] }];

export const KILL_ENV = { DPT_GATE_TIMEOUT_MS: "1500", DPT_GATE_KILL_GRACE_MS: "300" };

// ------------------------------------------------------------------ legs

/** One assertion bundle over a front-door run; returns null when it holds, else why not. */
export interface Leg {
  readonly name: string;
  /** A permit leg runs the table path (key absent) and must hold on every mutant. */
  readonly permit: boolean;
  readonly check: (srcRoot: string) => string | null;
}

function problems(list: Array<string | null>, r: DoorRun, extra = ""): string | null {
  const bad = list.filter((p): p is string => p !== null);
  return bad.length === 0 ? null : `${bad.join("\n")}\n${extra}${show(r)}`;
}

function eq(label: string, actual: unknown, expected: unknown): string | null {
  return JSON.stringify(actual) === JSON.stringify(expected) ? null : `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
}

function callsShape(bin: FakeBin): Array<{ name: string; args: string[] }> {
  return bin.calls().map((c) => ({ name: c.name, args: c.args }));
}

function fvmWorld(label: string, git: boolean) {
  const bin = makeBin(label, [
    { name: "fvm", out: FLUTTER_SUMMARY },
    { name: "flutter", out: BARE_FLUTTER_SUMMARY },
  ]);
  const root = makeProject(label, { marker: "pubspec.yaml", settings: settingsYaml(FVM_ENTRY), git });
  return { bin, root };
}

function makeWorld(label: string, git: boolean, opts: { worker?: readonly string[]; slow?: boolean } = {}) {
  const byArg: Record<string, readonly string[]> = { "test-api": API_SUMMARY, "test-worker": opts.worker ?? WORKER_SUMMARY };
  if (opts.slow) byArg["test-slow"] = ["============ 3 passed in 0.10s ============"];
  const bin = makeBin(label, [
    { name: "make", byArg, sleepOn: opts.slow ? ["test-slow"] : [] },
    { name: "python3", out: ["============ 50 passed in 0.01s ============"] },
  ]);
  const entries: TestCommandEntry[] = opts.slow ? [MAKE_ENTRIES[0]!, { stack: "pytest", command: ["make", "test-slow"] }] : MAKE_ENTRIES;
  const root = makeProject(label, { marker: "pytest.ini", settings: settingsYaml(entries), git });
  return { bin, root };
}

function refusalProblems(r: DoorRun, entry: string): Array<string | null> {
  const all = `${r.stdout}\n${r.stderr}`;
  return [
    r.exitCode === 0 ? "the front door exited 0 — a refusal must exit non-zero" : null,
    /Remedy:/.test(all) ? null : "no `Remedy:` line (NFR-10 shape)",
    /Context:/.test(all) ? null : "no `Context:` line (NFR-10 shape)",
    all.includes(entry) ? null : `the refusal does not name the entry \`${entry}\``,
  ];
}

export const LEGS: Leg[] = [
  // ---- permit legs (key absent → the stack_layout table, as in v3.3.0)
  {
    name: "gate PERMIT — key absent: the table's python3 -m pytest runs",
    permit: true,
    check: (src) => {
      const bin = makeBin("p-gate", [{ name: "python3", out: TABLE_PYTEST_SUMMARY, exitCode: 1 }]);
      const root = makeProject("p-gate", { marker: "pytest.ini", settings: settingsYaml() });
      const r = runGateCapture(src, root, bin);
      return problems(
        [
          eq("calls", callsShape(bin), [{ name: "python3", args: ["-m", "pytest"] }]),
          eq("totals", totalsLines(r), ["gate_capture: pass 3, fail 1, skip 2"]),
          eq("exit", r.exitCode, 0),
        ],
        r,
      );
    },
  },
  {
    name: "baseline PERMIT — key absent: the table's python3 -m pytest runs",
    permit: true,
    check: (src) => {
      const bin = makeBin("p-base", [{ name: "python3", out: TABLE_PYTEST_SUMMARY, exitCode: 1 }]);
      const root = makeProject("p-base", { marker: "pytest.ini", settings: settingsYaml(), git: true });
      const r = runBaselineCapture(src, root, bin);
      const rec = baselineRecord(root);
      return problems(
        [
          eq("calls", callsShape(bin), [{ name: "python3", args: ["-m", "pytest"] }]),
          eq("exit", r.exitCode, 0),
          eq("record.skipped", rec?.skipped, 2),
        ],
        r,
      );
    },
  },

  // ---- declared-read legs
  {
    name: "gate DECLARED — the fvm wrapper runs and bare flutter does not",
    permit: false,
    check: (src) => {
      const { bin, root } = fvmWorld("d-gate", false);
      const r = runGateCapture(src, root, bin);
      return problems(
        [
          eq("calls", bin.calls(), [{ name: "fvm", args: ["flutter", "test"], cwd: root }]),
          eq("totals", totalsLines(r), ["gate_capture: pass 5, fail 0, skip 1"]),
          eq("exit", r.exitCode, 0),
        ],
        r,
      );
    },
  },
  {
    name: "baseline DECLARED — the fvm wrapper runs and bare flutter does not",
    permit: false,
    check: (src) => {
      const { bin, root } = fvmWorld("d-base", true);
      const r = runBaselineCapture(src, root, bin);
      const rec = baselineRecord(root);
      return problems(
        [
          eq("calls", bin.calls(), [{ name: "fvm", args: ["flutter", "test"], cwd: root }]),
          eq("exit", r.exitCode, 0),
          eq("record.skipped", rec?.skipped, 1),
          JSON.stringify(rec ?? {}).includes("fvm flutter test") ? null : "the record does not name `fvm flutter test`",
        ],
        r,
        `record: ${JSON.stringify(rec)}\n`,
      );
    },
  },

  // ---- summation legs
  {
    name: "gate SUM — two make entries run in order and their counts add up",
    permit: false,
    check: (src) => {
      const { bin, root } = makeWorld("s-gate", false);
      const r = runGateCapture(src, root, bin);
      return problems(
        [
          eq("calls", bin.calls(), [
            { name: "make", args: ["test-api"], cwd: root },
            { name: "make", args: ["test-worker"], cwd: root },
          ]),
          eq("totals", totalsLines(r), ["gate_capture: pass 7, fail 1, skip 3"]),
          eq("exit", r.exitCode, 0),
        ],
        r,
      );
    },
  },
  {
    name: "gate SUM — mixed stacks: each entry is parsed by its own stack, then summed",
    permit: false,
    check: (src) => {
      const bin = makeBin("s-mixed", [
        { name: "bun", out: [" 4 pass", " 1 skip", " 1 fail", "Ran 6 tests across 2 files."], exitCode: 1 },
        { name: "make", byArg: { "test-worker": ["============ 2 passed, 1 skipped in 0.10s ============"] } },
      ]);
      const entries: TestCommandEntry[] = [
        { stack: "bun", command: ["bun", "test"] },
        { stack: "pytest", command: ["make", "test-worker"] },
      ];
      const root = makeProject("s-mixed", { marker: "package.json", settings: settingsYaml(entries) });
      const r = runGateCapture(src, root, bin);
      return problems(
        [
          eq("calls", callsShape(bin), [
            { name: "bun", args: ["test"] },
            { name: "make", args: ["test-worker"] },
          ]),
          eq("totals", totalsLines(r), ["gate_capture: pass 6, fail 1, skip 2"]),
        ],
        r,
      );
    },
  },
  {
    name: "baseline SUM — the record's skip count is the sum and it names both commands in order",
    permit: false,
    check: (src) => {
      const { bin, root } = makeWorld("s-base", true);
      const r = runBaselineCapture(src, root, bin);
      const rec = baselineRecord(root);
      const text = JSON.stringify(rec ?? {});
      const a = text.indexOf("make test-api");
      const w = text.indexOf("make test-worker");
      return problems(
        [
          eq("calls", callsShape(bin), [
            { name: "make", args: ["test-api"] },
            { name: "make", args: ["test-worker"] },
          ]),
          eq("exit", r.exitCode, 0),
          eq("record.skipped", rec?.skipped, 3),
          a !== -1 && w !== -1 && a < w ? null : "the record does not name `make test-api` then `make test-worker`, in that order",
        ],
        r,
        `record: ${text}\n`,
      );
    },
  },

  // ---- fail-closed legs
  {
    name: "gate CLOSED — an entry with no readable count refuses, and no partial sum stands",
    permit: false,
    check: (src) => {
      const { bin, root } = makeWorld("c-gate", false, { worker: NO_COUNT });
      const r = runGateCapture(src, root, bin);
      return problems(
        [...refusalProblems(r, "make test-worker"), r.stdout.split("\n").some((l) => TOTALS_RE.test(l)) ? "a totals line with numbers was printed — a partial sum stood" : null],
        r,
      );
    },
  },
  {
    name: "baseline CLOSED — an entry with no readable count refuses and writes no baseline",
    permit: false,
    check: (src) => {
      const { bin, root } = makeWorld("c-base", true, { worker: NO_COUNT });
      const r = runBaselineCapture(src, root, bin);
      return problems([...refusalProblems(r, "make test-worker"), existsSync(join(root, STORE_REL)) ? "a baseline store was written" : null], r);
    },
  },
  {
    name: "gate CLOSED — an entry killed on its bound refuses, even though it printed a count",
    permit: false,
    check: (src) => {
      const { bin, root } = makeWorld("k-gate", false, { slow: true });
      const r = runGateCapture(src, root, bin, KILL_ENV);
      return problems(
        [...refusalProblems(r, "make test-slow"), r.stdout.split("\n").some((l) => TOTALS_RE.test(l)) ? "a totals line with numbers was printed — a partial sum stood" : null],
        r,
      );
    },
  },
  {
    name: "baseline CLOSED — an entry killed on its bound refuses and writes no baseline",
    permit: false,
    check: (src) => {
      const { bin, root } = makeWorld("k-base", true, { slow: true });
      const r = runBaselineCapture(src, root, bin, KILL_ENV);
      return problems([...refusalProblems(r, "make test-slow"), existsSync(join(root, STORE_REL)) ? "a baseline store was written" : null], r);
    },
  },
];

export const LEG_BY_NAME = new Map(LEGS.map((l) => [l.name, l]));
