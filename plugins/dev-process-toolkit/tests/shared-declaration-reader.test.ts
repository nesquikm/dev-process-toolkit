// STE-602 — a shared tracker container is declared once and read by code.
//
// Suite for the declaration reader (`readWorkspaceBinding` + `repo_tag` /
// `min_dpt_version`), the running-version module (`dpt_version.ts`), the
// receipt store (`receiptsDir` + `tracker_receipts.ts`), the reader's
// command-line front door, the old-client leg and the reachability ledger move.
//
// Modules this FR introduces are loaded with `await import(...)` INSIDE each
// test, and the fixture helpers through a namespace import, so every AC reds
// (and later greens) on its own rather than the whole file failing to link.
//
// Fixtures: `makeSpanFixture` two-root trees; the `claudeMd(root, opts)` and
// `pluginManifest(dir, version)` helpers from `tests/_span_fixture.ts`. Every
// fixture is removed in `finally`.

import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import * as spanFixture from "./_span_fixture";
import * as bindingModule from "../adapters/_shared/src/workspace_binding";
import * as dptPaths from "../adapters/_shared/src/dpt_paths";
import { RepoTagBindingError } from "../adapters/_shared/src/create_idempotency_probe";
import { DPT_GITIGNORE_BODY } from "../adapters/_shared/src/setup/dpt_gitignore";
import {
  buildModuleGraph,
  ORDERED_UNREACHABLE_PIN_LEDGER,
  runModuleReachabilityProbe,
} from "../adapters/_shared/src/module_reachability";

const pluginRoot = join(import.meta.dir, "..");
const repoRoot = join(pluginRoot, "..", "..");
const sharedSrc = join(pluginRoot, "adapters", "_shared", "src");
const PRE_CHANGE = "ac1f3cb";
const TAG = "glacy-be";

// ----------------------------------------------------------------- loaders

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyModule = any;

async function loadVersion(): Promise<AnyModule> {
  return await import("../adapters/_shared/src/dpt_version");
}

async function loadReceipts(): Promise<AnyModule> {
  return await import("../adapters/_shared/src/tracker_receipts");
}

async function loadCoverage(): Promise<AnyModule> {
  return await import("../adapters/_shared/src/migrations/coverage");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const read = (bindingModule as any).readWorkspaceBinding as (
  p: string,
  k: "linear" | "jira",
) => Record<string, unknown>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fx = spanFixture as any;

interface ClaudeMdOpts {
  mode: "jira" | "linear";
  project?: string;
  team?: string;
  defaultLabels?: string[];
  repoTag?: string;
  minDptVersion?: string;
  paragraph?: string;
}

/** Write `<root>/CLAUDE.md` through the fixture helper; return its path. */
function writeClaudeMd(root: string, opts: ClaudeMdOpts): string {
  expect(typeof fx.claudeMd, "tests/_span_fixture.ts must export claudeMd(root, opts)").toBe(
    "function",
  );
  fx.claudeMd(root, opts);
  const path = join(root, "CLAUDE.md");
  expect(existsSync(path)).toBe(true);
  return path;
}

/** Write `<dir>/.claude-plugin/plugin.json` through the fixture helper. */
function writeManifest(dir: string, version: string): void {
  expect(
    typeof fx.pluginManifest,
    "tests/_span_fixture.ts must export pluginManifest(dir, version)",
  ).toBe("function");
  fx.pluginManifest(dir, version);
  expect(existsSync(join(dir, ".claude-plugin", "plugin.json"))).toBe(true);
}

function withFixture<T>(body: (f: { a: string; b: string }) => T): T {
  const f = spanFixture.makeSpanFixture("M_947c79");
  try {
    return body(f);
  } finally {
    f.cleanup();
  }
}

async function withFixtureAsync<T>(body: (f: { a: string; b: string }) => Promise<T>): Promise<T> {
  const f = spanFixture.makeSpanFixture("M_947c79");
  try {
    return await body(f);
  } finally {
    f.cleanup();
  }
}

function parseVersion(v: string): [number, number, number] {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!m) throw new Error(`not strict X.Y.Z: ${v}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** The nearest strict version strictly below `v`. */
function below(v: string): string {
  const [a, b, c] = parseVersion(v);
  if (c > 0) return `${a}.${b}.${c - 1}`;
  if (b > 0) return `${a}.${b - 1}.0`;
  return `${a - 1}.0.0`;
}

/** A strict version strictly above `v`. */
function above(v: string): string {
  const [a, b] = parseVersion(v);
  return `${a}.${b + 1}.0`;
}

function catchRefusal(fn: () => unknown): Error {
  let caught: unknown = null;
  let returned: unknown = undefined;
  try {
    returned = fn();
  } catch (e) {
    caught = e;
  }
  expect(
    caught,
    `expected a thrown refusal, got a return: ${JSON.stringify(returned)}`,
  ).toBeInstanceOf(Error);
  return caught as Error;
}

/** NFR-10 three-line shape: verdict, `Remedy:`, `Context:`. */
function expectThreeLine(err: Error): [string, string, string] {
  const lines = err.message.split("\n");
  expect(lines.length, `refusal is not exactly three lines:\n${err.message}`).toBe(3);
  expect(lines[0]!.trim().length).toBeGreaterThan(0);
  expect(lines[1]!.startsWith("Remedy:"), err.message).toBe(true);
  expect(lines[2]!.startsWith("Context:"), err.message).toBe(true);
  return lines as [string, string, string];
}

/** A typed refusal from the reader itself (every class but #2). */
function expectReaderRefusal(err: Error, key: string, value: string): void {
  const [verdict, , context] = expectThreeLine(err);
  expect(err.name, "the refusal must be a typed error, not a bare Error").not.toBe("Error");
  expect(verdict).toContain(key);
  expect(verdict).toContain(value);
  expect(context).toContain("file=");
  expect(context).toContain("CLAUDE.md");
  expect(context).toContain("adapter=jira");
  expect(context).toContain("helper=readWorkspaceBinding");
}

async function firstGated(): Promise<string> {
  const mod = await loadVersion();
  expect(typeof mod.FIRST_GATED_DPT_VERSION).toBe("string");
  return mod.FIRST_GATED_DPT_VERSION as string;
}

function declared(floor: string, over: Partial<ClaudeMdOpts> = {}): ClaudeMdOpts {
  return {
    mode: "jira",
    project: "GF",
    defaultLabels: [TAG],
    repoTag: TAG,
    minDptVersion: floor,
    ...over,
  };
}

// ============================================================ AC-STE-602.1

describe("AC-STE-602.1 — a declared sub-section reads back shared", () => {
  test("Jira: repoTag, minDptVersion and shared: true", async () => {
    const floor = await firstGated();
    withFixture(({ a }) => {
      const path = writeClaudeMd(a, declared(floor));
      expect(read(path, "jira")).toEqual({
        project: "GF",
        defaultLabels: [TAG],
        repoTag: TAG,
        minDptVersion: floor,
        shared: true,
      });
    });
  });

  test("Linear: the same declaration in `### Linear`", async () => {
    const floor = await firstGated();
    withFixture(({ a }) => {
      const path = writeClaudeMd(a, {
        mode: "linear",
        team: "STE",
        project: "DPT",
        defaultLabels: ["dpt"],
        repoTag: "dpt",
        minDptVersion: floor,
      });
      expect(read(path, "linear")).toEqual({
        team: "STE",
        project: "DPT",
        defaultLabels: ["dpt"],
        repoTag: "dpt",
        minDptVersion: floor,
        shared: true,
      });
    });
  });

  test("undeclared: the pre-change return plus shared: false and nothing else", () => {
    withFixture(({ a }) => {
      const path = writeClaudeMd(a, { mode: "jira", project: "GF", defaultLabels: [TAG] });
      expect(read(path, "jira")).toEqual({
        project: "GF",
        defaultLabels: [TAG],
        shared: false,
      });
    });
  });
});

// ============================================================ AC-STE-602.2

describe("AC-STE-602.2 — the seven refusal classes, each beside its one-change control", () => {
  test("class 1: repo_tag not lowercase-kebab refuses; a valid tag returns", async () => {
    const floor = await firstGated();
    withFixture(({ a, b }) => {
      const bad = "Glacy_BE";
      const pBad = writeClaudeMd(a, declared(floor, { repoTag: bad, defaultLabels: [bad] }));
      expectReaderRefusal(catchRefusal(() => read(pBad, "jira")), "repo_tag", bad);
      const pOk = writeClaudeMd(b, declared(floor));
      expect(read(pOk, "jira").shared).toBe(true);
    });
  });

  test("class 2: repo_tag absent from default_labels refuses through RepoTagBindingError", async () => {
    const floor = await firstGated();
    withFixture(({ a, b }) => {
      const pBad = writeClaudeMd(a, declared(floor, { defaultLabels: ["other"] }));
      const err = catchRefusal(() => read(pBad, "jira"));
      expect(err).toBeInstanceOf(RepoTagBindingError);
      const [verdict] = expectThreeLine(err);
      expect(verdict).toContain("repo_tag");
      expect(verdict).toContain(TAG);
      const pOk = writeClaudeMd(b, declared(floor, { defaultLabels: ["other", TAG] }));
      expect(read(pOk, "jira")).toMatchObject({ repoTag: TAG, shared: true });
    });
  });

  test("class 3: min_dpt_version not strict X.Y.Z refuses (v-prefix, pre-release); strict returns", async () => {
    const floor = await firstGated();
    for (const bad of [`v${floor}`, `${floor}-rc.1`]) {
      withFixture(({ a }) => {
        const pBad = writeClaudeMd(a, declared(bad));
        expectReaderRefusal(catchRefusal(() => read(pBad, "jira")), "min_dpt_version", bad);
      });
    }
    withFixture(({ b }) => {
      const pOk = writeClaudeMd(b, declared(floor));
      expect(read(pOk, "jira").minDptVersion).toBe(floor);
    });
  });

  test("class 4: repo_tag without a floor, and a floor without repo_tag, each refuse; both keys return", async () => {
    const floor = await firstGated();
    withFixture(({ a, b }) => {
      const pTagOnly = writeClaudeMd(a, declared(floor, { minDptVersion: undefined }));
      expectReaderRefusal(catchRefusal(() => read(pTagOnly, "jira")), "repo_tag", TAG);
      const pFloorOnly = writeClaudeMd(b, declared(floor, { repoTag: undefined }));
      expectReaderRefusal(
        catchRefusal(() => read(pFloorOnly, "jira")),
        "min_dpt_version",
        floor,
      );
    });
    withFixture(({ a }) => {
      const pOk = writeClaudeMd(a, declared(floor));
      expect(read(pOk, "jira")).toMatchObject({ repoTag: TAG, minDptVersion: floor, shared: true });
    });
  });

  test("class 5: either key written twice refuses — never last-wins; one occurrence returns", async () => {
    const floor = await firstGated();
    withFixture(({ a, b }) => {
      const pTag = writeClaudeMd(a, declared(floor, { paragraph: `repo_tag: ${TAG}` }));
      expectReaderRefusal(catchRefusal(() => read(pTag, "jira")), "repo_tag", TAG);
      const pFloor = writeClaudeMd(b, declared(floor, { paragraph: `min_dpt_version: ${floor}` }));
      expectReaderRefusal(catchRefusal(() => read(pFloor, "jira")), "min_dpt_version", floor);
    });
    withFixture(({ a }) => {
      const pOk = writeClaudeMd(a, declared(floor));
      expect(read(pOk, "jira").shared).toBe(true);
    });
  });

  test("class 6: a floor below FIRST_GATED_DPT_VERSION refuses; a floor at it returns", async () => {
    const floor = await firstGated();
    const low = below(floor);
    withFixture(({ a, b }) => {
      const pBad = writeClaudeMd(a, declared(low));
      expectReaderRefusal(catchRefusal(() => read(pBad, "jira")), "min_dpt_version", low);
      const pOk = writeClaudeMd(b, declared(floor));
      expect(read(pOk, "jira").minDptVersion).toBe(floor);
    });
  });

  test("class 7: a CLAUDE.md that exists but cannot be read is a typed refusal naming the path; a readable file returns", async () => {
    const floor = await firstGated();
    withFixture(({ a, b }) => {
      // A directory at the path: it exists, and `readFileSync` cannot read it.
      const pBad = join(a, "CLAUDE.md");
      mkdirSync(pBad);
      const err = catchRefusal(() => read(pBad, "jira"));
      const [, , context] = expectThreeLine(err);
      expect(err.name).not.toBe("Error");
      expect(err.message).toContain("CLAUDE.md");
      expect(context).toContain("helper=readWorkspaceBinding");
      const pOk = writeClaudeMd(b, declared(floor));
      expect(read(pOk, "jira").shared).toBe(true);
    });
  });
});

// ============================================================ AC-STE-602.3

describe("AC-STE-602.3 — absent and relocated inputs", () => {
  test("an absent CLAUDE.md is shared: false with no refusal", () => {
    withFixture(({ a }) => {
      expect(read(join(a, "CLAUDE.md"), "jira")).toEqual({ shared: false });
    });
  });

  test("a CLAUDE.md with no `## Task Tracking` is shared: false", () => {
    withFixture(({ a }) => {
      const path = join(a, "CLAUDE.md");
      writeFileSync(path, `# Project\n\nrepo_tag: ${TAG}\nmin_dpt_version: 9.9.9\n`);
      expect(read(path, "jira")).toEqual({ shared: false });
    });
  });

  test("an empty `repo_tag:` with no floor is the undeclared state, byte-for-byte", () => {
    withFixture(({ a, b }) => {
      const withEmpty = writeClaudeMd(a, {
        mode: "jira",
        project: "GF",
        defaultLabels: [TAG],
        paragraph: "repo_tag:",
      });
      const absent = writeClaudeMd(b, { mode: "jira", project: "GF", defaultLabels: [TAG] });
      expect(readFileSync(withEmpty, "utf-8")).toContain("repo_tag:");
      const got = read(withEmpty, "jira");
      expect(got).toEqual({ project: "GF", defaultLabels: [TAG], shared: false });
      expect(JSON.stringify(got)).toBe(JSON.stringify(read(absent, "jira")));
    });
  });

  test("two roots — one declared, one not — answer independently", async () => {
    const floor = await firstGated();
    withFixture(({ a, b }) => {
      const pa = writeClaudeMd(a, declared(floor));
      const pb = writeClaudeMd(b, { mode: "jira", project: "GF", defaultLabels: [TAG] });
      expect(read(pa, "jira")).toMatchObject({ repoTag: TAG, shared: true });
      expect(read(pb, "jira")).toEqual({ project: "GF", defaultLabels: [TAG], shared: false });
      // Reading B again after A is unchanged: no state carried between reads.
      expect(read(pb, "jira").shared).toBe(false);
    });
  });

  test("the reader never opens a file other than the path it is given", async () => {
    const floor = await firstGated();
    withFixture(({ a }) => {
      // A declared CLAUDE.md sits at the root; the path handed over is a
      // nested one that does not exist. Walking up would find the declaration.
      writeClaudeMd(a, declared(floor));
      mkdirSync(join(a, "nested"));
      expect(read(join(a, "nested", "CLAUDE.md"), "jira")).toEqual({ shared: false });
      // And a MALFORMED root file is never consulted for a nested readable one.
      writeFileSync(
        join(a, "CLAUDE.md"),
        readFileSync(join(a, "CLAUDE.md"), "utf-8").replace(`repo_tag: ${TAG}`, "repo_tag: BAD_TAG"),
      );
      expect(() => read(join(a, "CLAUDE.md"), "jira")).toThrow();
      writeClaudeMd(join(a, "nested"), { mode: "jira", project: "GF", defaultLabels: [TAG] });
      expect(read(join(a, "nested", "CLAUDE.md"), "jira")).toEqual({
        project: "GF",
        defaultLabels: [TAG],
        shared: false,
      });
    });
  });
});

// ============================================================ AC-STE-602.4

describe("AC-STE-602.4 — runningDptVersion reads the manifest, never a literal", () => {
  test("returns the fixture manifest's version and moves when only the manifest moves", async () => {
    const { runningDptVersion } = await loadVersion();
    await withFixtureAsync(async ({ a }) => {
      writeManifest(a, "3.1.4");
      expect(runningDptVersion(a)).toBe("3.1.4");
      writeManifest(a, "3.2.0");
      expect(runningDptVersion(a)).toBe("3.2.0");
    });
  });

  test("a missing manifest, an unreadable one, `2.87` and `v2.87.0` each refuse", async () => {
    const { runningDptVersion } = await loadVersion();
    await withFixtureAsync(async ({ a, b }) => {
      // missing
      expect(() => runningDptVersion(a)).toThrow();
      // unreadable: a directory where the file should be
      mkdirSync(join(b, ".claude-plugin", "plugin.json"), { recursive: true });
      expect(() => runningDptVersion(b)).toThrow();
    });
    for (const bad of ["2.87", "v2.87.0"]) {
      await withFixtureAsync(async ({ a }) => {
        writeManifest(a, bad);
        let err: unknown = null;
        try {
          runningDptVersion(a);
        } catch (e) {
          err = e;
        }
        expect(err, `version "${bad}" must refuse`).toBeInstanceOf(Error);
        expect((err as Error).message).toContain(bad);
      });
    }
  });

  test("with no argument it returns the shipped plugin.json version", async () => {
    const { runningDptVersion } = await loadVersion();
    const shipped = JSON.parse(
      readFileSync(join(pluginRoot, ".claude-plugin", "plugin.json"), "utf-8"),
    ).version;
    const saved = process.env.CLAUDE_PLUGIN_ROOT;
    delete process.env.CLAUDE_PLUGIN_ROOT;
    try {
      expect(runningDptVersion()).toBe(shipped);
    } finally {
      if (saved !== undefined) process.env.CLAUDE_PLUGIN_ROOT = saved;
    }
  });

  test("CLAUDE_PLUGIN_ROOT, when set, is the default root", async () => {
    const { runningDptVersion } = await loadVersion();
    await withFixtureAsync(async ({ a }) => {
      writeManifest(a, "7.7.7");
      const saved = process.env.CLAUDE_PLUGIN_ROOT;
      process.env.CLAUDE_PLUGIN_ROOT = a;
      try {
        expect(runningDptVersion()).toBe("7.7.7");
      } finally {
        if (saved === undefined) delete process.env.CLAUDE_PLUGIN_ROOT;
        else process.env.CLAUDE_PLUGIN_ROOT = saved;
      }
    });
  });
});

// ============================================================ AC-STE-602.5

describe("AC-STE-602.5 — checkVersionFloor, driven through readWorkspaceBinding", () => {
  test("refuses when the running version is below the floor, naming both", async () => {
    const { runningDptVersion, checkVersionFloor } = await loadVersion();
    const gated = await firstGated();
    const floor = above(gated);
    await withFixtureAsync(async ({ a, b }) => {
      const binding = read(writeClaudeMd(a, declared(floor)), "jira");
      writeManifest(b, gated);
      const running = runningDptVersion(b);
      const verdict = checkVersionFloor(binding, running);
      expect(verdict.ok).toBe(false);
      const text = JSON.stringify(verdict);
      expect(text).toContain(floor);
      expect(text).toContain(gated);
    });
  });

  test("passes on equal and on greater", async () => {
    const { runningDptVersion, checkVersionFloor } = await loadVersion();
    const floor = await firstGated();
    await withFixtureAsync(async ({ a, b }) => {
      const binding = read(writeClaudeMd(a, declared(floor)), "jira");
      writeManifest(b, floor);
      expect(checkVersionFloor(binding, runningDptVersion(b)).ok).toBe(true);
      writeManifest(b, above(floor));
      expect(checkVersionFloor(binding, runningDptVersion(b)).ok).toBe(true);
    });
  });

  test("one semver comparison: coverage.ts exports compareSemver", async () => {
    const { compareSemver } = await loadCoverage();
    expect(typeof compareSemver).toBe("function");
    expect(compareSemver("2.86.0", "2.87.0")).toBe(-1);
    expect(compareSemver("2.87.0", "2.87.0")).toBe(0);
    expect(compareSemver("2.87.1", "2.87.0")).toBe(1);
  });
});

// ============================================================ AC-STE-602.6

describe("AC-STE-602.6 — FIRST_GATED_DPT_VERSION is the release that ships the gate", () => {
  test("two phases keyed on STE-607's listing in CHANGELOG.md", async () => {
    const gated = await firstGated();
    parseVersion(gated); // strict X.Y.Z
    const { compareSemver } = await loadCoverage();
    const changelog = readFileSync(join(repoRoot, "CHANGELOG.md"), "utf-8");
    const headingRe = /^## \[(\d+\.\d+\.\d+)\][^\n]*$/gm;
    const heads = [...changelog.matchAll(headingRe)];
    expect(heads.length).toBeGreaterThan(0);
    const entries = heads.map((m, i) => ({
      version: m[1]!,
      body: changelog.slice(m.index!, i + 1 < heads.length ? heads[i + 1]!.index! : undefined),
    }));
    const listing = entries.find((e) => /\bSTE-607\b/.test(e.body));
    if (!listing) {
      expect(
        compareSemver(gated, entries[0]!.version),
        `no release lists STE-607 yet, so FIRST_GATED_DPT_VERSION (${gated}) must be above the newest release ${entries[0]!.version}`,
      ).toBe(1);
    } else {
      expect(gated).toBe(listing.version);
    }
  });
});

// ============================================================ AC-STE-602.7

/** Strip `//` and block comments — a crude pass, adequate for path-segment scans. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
}

const RECEIPTS_SEGMENT = /["'`/]receipts["'`/]/;

function nonTestTs(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      out.push(...nonTestTs(abs));
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) {
      out.push(abs);
    }
  }
  return out;
}

function receiptComposers(roots: string[], base: string): string[] {
  const hits: string[] = [];
  for (const root of roots) {
    for (const file of nonTestTs(root)) {
      if (RECEIPTS_SEGMENT.test(stripComments(readFileSync(file, "utf-8")))) {
        hits.push(relative(base, file).split("\\").join("/"));
      }
    }
  }
  return hits.sort();
}

function git(root: string, ...args: string[]): string {
  return execFileSync(
    "git",
    [
      "-C",
      root,
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "user.name=fixture",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      ...args,
    ],
    { encoding: "utf-8" },
  );
}

function snapshotTree(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name === ".git") continue;
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) {
        out[relative(root, abs) + "/"] = "";
        walk(abs);
      } else {
        out[relative(root, abs)] = readFileSync(abs, "utf-8");
      }
    }
  };
  walk(root);
  return out;
}

function withSession<T>(id: string | undefined, body: () => T): T {
  const saved = process.env.CLAUDE_CODE_SESSION_ID;
  if (id === undefined) delete process.env.CLAUDE_CODE_SESSION_ID;
  else process.env.CLAUDE_CODE_SESSION_ID = id;
  try {
    return body();
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_CODE_SESSION_ID;
    else process.env.CLAUDE_CODE_SESSION_ID = saved;
  }
}

const RECEIPT_INPUT = {
  kind: "create",
  adapter: "jira",
  container: "GF",
  subject: "STE-602 fixture",
  decision: "create",
  evidence: { query: "project = GF AND labels = glacy-be", hits: 0 },
};

describe("AC-STE-602.7 — the receipt store", () => {
  test("receiptsDir composes <root>/.dpt/ledger/receipts/<sessionId>", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const receiptsDir = (dptPaths as any).receiptsDir;
    expect(typeof receiptsDir).toBe("function");
    expect(receiptsDir("/p", "sess-1")).toBe(join("/p", ".dpt", "ledger", "receipts", "sess-1"));
    for (const bad of ["", "../x", "a/b", "a b", ".."]) {
      expect(() => receiptsDir("/p", bad), `session id ${JSON.stringify(bad)}`).toThrow();
    }
  });

  test("receiptsDir is the only composer of the receipts segment; a planted second composer is found", () => {
    const roots = [sharedSrc, join(pluginRoot, "templates", "hooks")];
    expect(receiptComposers(roots, pluginRoot)).toEqual(["adapters/_shared/src/dpt_paths.ts"]);

    // Control: a fixture copy with a planted second composer.
    const scratch = mkdtempSync(join(tmpdir(), "ste602-composer-"));
    try {
      cpSync(sharedSrc, join(scratch, "src"), { recursive: true });
      writeFileSync(
        join(scratch, "src", "planted_composer.ts"),
        'import { join } from "node:path";\nexport const p = (r: string) => join(r, ".dpt", "ledger", "receipts");\n',
      );
      expect(receiptComposers([join(scratch, "src")], scratch)).toEqual([
        "src/dpt_paths.ts",
        "src/planted_composer.ts",
      ]);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  test("a written receipt lands under the ignored ledger, with the three-rule .dpt/.gitignore untouched", async () => {
    const { writeReceipt, readSessionReceipts } = await loadReceipts();
    withFixture(({ a }) => {
      git(a, "init", "-q");
      const path = withSession("sess-A", () => writeReceipt(a, RECEIPT_INPUT)) as string;
      expect(path.startsWith(join(a, ".dpt", "ledger", "receipts", "sess-A") + "/")).toBe(true);
      expect(existsSync(path)).toBe(true);
      const receipt = JSON.parse(readFileSync(path, "utf-8"));
      expect(receipt).toMatchObject({
        v: 1,
        kind: "create",
        sessionId: "sess-A",
        root: a,
        adapter: "jira",
        container: "GF",
        subject: "STE-602 fixture",
        decision: "create",
        evidence: RECEIPT_INPUT.evidence,
      });
      expect(typeof receipt.createdAt).toBe("string");
      // ignored
      expect(git(a, "check-ignore", relative(a, path)).trim()).toBe(relative(a, path));
      // the CLOSED three-rule file
      expect(readFileSync(join(a, ".dpt", ".gitignore"), "utf-8")).toBe(DPT_GITIGNORE_BODY);
      expect(DPT_GITIGNORE_BODY.trim().split("\n").length).toBe(3);
      // no nested ignore file
      const ignores = Object.keys(snapshotTree(join(a, ".dpt"))).filter((k) =>
        k.endsWith(".gitignore"),
      );
      expect(ignores).toEqual([".gitignore"]);
      // reads back
      const got = readSessionReceipts(a, "sess-A");
      expect(got.receipts.length).toBe(1);
      expect(got.receipts[0]).toMatchObject({ kind: "create", sessionId: "sess-A" });
    });
  });

  test("the announcement prefix is `dpt-receipt: `", async () => {
    const mod = await loadReceipts();
    const values = Object.values(mod).filter((v) => typeof v === "string");
    expect(values).toContain("dpt-receipt: ");
  });

  test("fresh checkout: the first write leaves only the canonical .dpt/.gitignore untracked", async () => {
    const { writeReceipt } = await loadReceipts();
    withFixture(({ a }) => {
      // `makeSpanFixture` roots carry empty `specs/` dirs only — git lists no directories.
      git(a, "init", "-q");
      expect(existsSync(join(a, ".dpt"))).toBe(false);
      withSession("sess-A", () => writeReceipt(a, RECEIPT_INPUT));
      expect(git(a, "status", "--porcelain", "-uall").trim().split("\n")).toEqual([
        "?? .dpt/.gitignore",
      ]);
    });
  });

  test("with the canonical .dpt/.gitignore committed first, a write leaves status empty", async () => {
    const { writeReceipt } = await loadReceipts();
    withFixture(({ a }) => {
      git(a, "init", "-q");
      mkdirSync(join(a, ".dpt"));
      writeFileSync(join(a, ".dpt", ".gitignore"), DPT_GITIGNORE_BODY);
      git(a, "add", ".dpt/.gitignore");
      git(a, "commit", "-q", "-m", "chore: fixture");
      withSession("sess-A", () => writeReceipt(a, RECEIPT_INPUT));
      expect(git(a, "status", "--porcelain", "-uall")).toBe("");
    });
  });

  test("a hand-edited .dpt/.gitignore is left byte-identical (control)", async () => {
    const { writeReceipt } = await loadReceipts();
    withFixture(({ a }) => {
      git(a, "init", "-q");
      mkdirSync(join(a, ".dpt"));
      const edited = `${DPT_GITIGNORE_BODY}# hand-kept\n`;
      writeFileSync(join(a, ".dpt", ".gitignore"), edited);
      withSession("sess-A", () => writeReceipt(a, RECEIPT_INPUT));
      expect(readFileSync(join(a, ".dpt", ".gitignore"), "utf-8")).toBe(edited);
    });
  });

  test("an unset, empty or path-unsafe session id refuses and leaves the tree byte-unchanged", async () => {
    const { writeReceipt } = await loadReceipts();
    for (const id of [undefined, "", "../x", "a/b"]) {
      withFixture(({ a }) => {
        git(a, "init", "-q");
        const before = snapshotTree(a);
        expect(
          () => withSession(id, () => writeReceipt(a, RECEIPT_INPUT)),
          `session id ${JSON.stringify(id)} must refuse`,
        ).toThrow();
        expect(snapshotTree(a)).toEqual(before);
      });
    }
  });

  test("a malformed receipt file is skipped and counted", async () => {
    const { writeReceipt, readSessionReceipts } = await loadReceipts();
    withFixture(({ a }) => {
      const path = withSession("sess-A", () => writeReceipt(a, RECEIPT_INPUT)) as string;
      writeFileSync(join(path, "..", "zz-broken.json"), "{ not json");
      const got = readSessionReceipts(a, "sess-A");
      expect(got.receipts.length).toBe(1);
      expect(got.skipped).toBe(1);
    });
  });

  test("a receipt written under session A is never returned when reading session B", async () => {
    const { writeReceipt, readSessionReceipts } = await loadReceipts();
    withFixture(({ a }) => {
      withSession("sess-A", () => writeReceipt(a, RECEIPT_INPUT));
      expect(readSessionReceipts(a, "sess-A").receipts.length).toBe(1);
      const got = readSessionReceipts(a, "sess-B");
      expect(got.receipts).toEqual([]);
    });
  });
});

// ============================================================ AC-STE-602.8

describe("AC-STE-602.8 — the reader's front door", () => {
  const entry = join(sharedSrc, "workspace_binding.ts");

  async function run(
    root: string,
    manifestDir: string,
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    const proc = Bun.spawn(["bun", "run", entry, root], {
      cwd: pluginRoot,
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: manifestDir },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code, stdout, stderr };
  }

  test("declared → exit 0, one JSON binding line and `running=<v> floor=ok`", async () => {
    const floor = await firstGated();
    await withFixtureAsync(async ({ a, b }) => {
      writeClaudeMd(a, declared(floor));
      writeManifest(b, floor);
      const r = await run(a, b);
      expect(r.code, r.stderr).toBe(0);
      const lines = r.stdout.trimEnd().split("\n");
      expect(lines.length).toBe(2);
      expect(JSON.parse(lines[0]!)).toEqual({
        project: "GF",
        defaultLabels: [TAG],
        repoTag: TAG,
        minDptVersion: floor,
        shared: true,
      });
      expect(lines[1]).toBe(`running=${floor} floor=ok`);
    });
  }, 30_000);

  test("undeclared → exit 0 printing shared:false", async () => {
    await withFixtureAsync(async ({ a, b }) => {
      writeClaudeMd(a, { mode: "jira", project: "GF", defaultLabels: [TAG] });
      writeManifest(b, "9.9.9");
      const r = await run(a, b);
      expect(r.code, r.stderr).toBe(0);
      expect(r.stdout).toContain('"shared":false');
      const first = JSON.parse(r.stdout.split("\n")[0]!);
      expect(first).toEqual({ project: "GF", defaultLabels: [TAG], shared: false });
    });
  }, 30_000);

  test("malformed → exit 1, the refusal on stderr, empty stdout", async () => {
    const floor = await firstGated();
    await withFixtureAsync(async ({ a, b }) => {
      writeClaudeMd(a, declared(floor, { repoTag: "Bad_Tag", defaultLabels: ["Bad_Tag"] }));
      writeManifest(b, floor);
      const r = await run(a, b);
      expect(r.code).toBe(1);
      expect(r.stdout).toBe("");
      expect(r.stderr).toContain("Bad_Tag");
      expect(r.stderr).toContain("Remedy:");
      expect(r.stderr).toContain("Context:");
    });
  }, 30_000);
});

// ============================================================ AC-STE-602.9

describe("AC-STE-602.9 — old clients keep tagging", () => {
  test("the pre-change reader and probe #21 read a declared file safely; a top-level control still reds", async () => {
    const floor = await firstGated();
    const scratch = mkdtempSync(join(tmpdir(), "ste602-oldclient-"));
    try {
      for (const file of ["workspace_binding.ts", "task_tracking_canonical_keys.ts"]) {
        const src = execFileSync(
          "git",
          ["-C", repoRoot, "show", `${PRE_CHANGE}:plugins/dev-process-toolkit/adapters/_shared/src/${file}`],
          { encoding: "utf-8" },
        );
        writeFileSync(join(scratch, file), src);
      }
      const oldReader = await import(join(scratch, "workspace_binding.ts"));
      const oldProbe = await import(join(scratch, "task_tracking_canonical_keys.ts"));

      await withFixtureAsync(async ({ a, b }) => {
        const path = writeClaudeMd(a, declared(floor));
        const old = oldReader.readWorkspaceBinding(path, "jira");
        expect(old.project).toBe("GF");
        expect(old.defaultLabels).toContain(TAG);
        const report = await oldProbe.runTaskTrackingCanonicalKeysProbe(a);
        expect(report.violations).toEqual([]);

        // Control: `repo_tag` at the TOP level of `## Task Tracking`.
        writeFileSync(
          join(b, "CLAUDE.md"),
          [
            "# Project",
            "",
            "## Task Tracking",
            "",
            "mode: jira",
            `repo_tag: ${TAG}`,
            "",
            "### Jira",
            "",
            "project: GF",
            `default_labels: [${TAG}]`,
            "",
          ].join("\n"),
        );
        const control = await oldProbe.runTaskTrackingCanonicalKeysProbe(b);
        expect(control.violations.length).toBe(1);
      });
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

// ============================================================ AC-STE-602.10

describe("AC-STE-602.10 — the front door makes workspace_binding.ts reachable", () => {
  test("the module carries an entry point and is reachable", () => {
    const graph = buildModuleGraph(repoRoot);
    expect(graph.hasEntryPoint("adapters/_shared/src/workspace_binding.ts")).toBe(true);
    expect(graph.reachable("adapters/_shared/src/workspace_binding.ts")).toBe(true);
  });

  // PIN MOVE (M_947c79/STE-603): later FRs prepend their own moves, so this
  // FR's entry is FOUND by its rationale rather than assumed to be the head.
  // It must still be one entry, sit directly on the 129 it lowered, and the
  // head must still equal the awaited measurement.
  test("the ledger records one STE-602 lowering from 129, and the head equals the awaited measurement", async () => {
    const mine = ORDERED_UNREACHABLE_PIN_LEDGER.filter((m) => m.rationale.includes("STE-602"));
    expect(mine.length, "exactly one ledger entry names STE-602").toBe(1);
    const at = ORDERED_UNREACHABLE_PIN_LEDGER.indexOf(mine[0]!);
    expect(ORDERED_UNREACHABLE_PIN_LEDGER[at + 1]!.value, "it lowered the 129 entry").toBe(129);
    expect(mine[0]!.value, "the pin may only fall — a raise is forbidden").toBeLessThan(129);
    const head = ORDERED_UNREACHABLE_PIN_LEDGER[0]!;
    const report = await runModuleReachabilityProbe(repoRoot);
    expect(
      report.orderedUnreachable,
      `measured ${report.orderedUnreachable} against ledger head ${head.value}`,
    ).toBe(head.value);
    expect(report.ok).toBe(true);
  }, 120_000);

  test("no skill file carries this FR's token", () => {
    const skills = join(pluginRoot, "skills");
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const abs = join(dir, n);
        return statSync(abs).isDirectory() ? walk(abs) : n.endsWith(".md") ? [abs] : [];
      });
    const offenders = walk(skills).filter((f) => readFileSync(f, "utf-8").includes("STE-602"));
    expect(offenders).toEqual([]);
  });
});
