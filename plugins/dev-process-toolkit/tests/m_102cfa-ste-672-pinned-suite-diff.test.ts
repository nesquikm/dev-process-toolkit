// M_102cfa / STE-672 — suite-edit guards measure against a pinned commit.
//
// THE DEFECT, measured on merged trunk 67bdf452 after PR #109: the 590 suite's
// m143-551 mutation test diffs `tests/m143-ste-551-continuation-offers.test.ts`
// against `main` and requires the diff to be NON-EMPTY (`toContain("@@ ")`).
// Once the branch merged, `main` held the edits, the diff read empty, and the
// test went red on trunk. The fix pins both m143-551 assertions to `d7af0428`
// (the AC-STE-618.8 freeze base) through one named constant, and a scanner
// fences any test that asserts a non-empty diff against a moving ref.
//
// Fixture sources below spell the double quote as `§` and are decoded at run
// time, so this file never carries the very shape the real-tree scan forbids.

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ===========================================================================
// Paths and pins.
// ===========================================================================

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const TESTS_DIR = join(PLUGIN_ROOT, "tests");
const SUITE_590_REL = "tests/m_79b1f6-ste-590-offers-ask-the-gate.test.ts";
const SUITE_590 = join(PLUGIN_ROOT, SUITE_590_REL);
const M143_REL = "tests/m143-ste-551-continuation-offers.test.ts";
const M143_REPO_REL = `plugins/dev-process-toolkit/${M143_REL}`;
const SUITE_590_REPO_REL = `plugins/dev-process-toolkit/${SUITE_590_REL}`;
const SCANNER = join(PLUGIN_ROOT, "adapters", "_shared", "src", "moving_ref_diff_scan.ts");

/** The pinned base the FR names (AC-STE-672.1). */
const PINNED = "d7af0428";
/** Merged trunk after PR #109, where the defect reproduced (AC-STE-672.2). */
const MERGED_TRUNK = "67bdf452";

const MARKER_670 = /Amended by AC-STE-670\.4\b/;

const git = (args: string[], cwd = REPO_ROOT) =>
  spawnSync("git", args, { cwd, encoding: "utf-8" });

const decode = (s: string): string => s.replace(/§/g, '"');

type Hit = { file: string; line: number; snippet: string };
type ScannerModule = {
  scanMovingRefDiffAssertions: (testsDir: string) => Hit[];
  scanSourceForMovingRefDiffAssertions: (source: string, file: string) => Hit[];
};

async function loadScanner(): Promise<ScannerModule> {
  expect(existsSync(SCANNER), `scanner module missing at ${SCANNER}`).toBe(true);
  const mod = (await import(SCANNER)) as ScannerModule;
  expect(typeof mod.scanMovingRefDiffAssertions).toBe("function");
  expect(typeof mod.scanSourceForMovingRefDiffAssertions).toBe("function");
  return mod;
}

/** Hunks of a unified diff that add no line carrying the STE-670.4 marker. */
function unmarked670(diff: string): string[] {
  return diff
    .split(/^(?=@@ )/m)
    .filter((h) => h.startsWith("@@ "))
    .filter((h) => !h.split("\n").some((l) => l.startsWith("+") && MARKER_670.test(l)))
    .map((h) => h.split("\n")[0]!);
}

const src590 = (): string => readFileSync(SUITE_590, "utf-8").replace(/\r\n/g, "\n");

/** The body of the 590 suite's m143-551 MUTATION test, up to the next `test(`. */
function mutationBlock(source: string): string {
  const start = source.indexOf("MUTATION: an unmarked hunk in the m143-551 diff");
  expect(start, "the m143-551 MUTATION test is gone from the 590 suite").toBeGreaterThan(-1);
  const rest = source.slice(start);
  const next = rest.slice(1).search(/\n\s*test\(/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

// ===========================================================================
// AC-STE-672.1 — the m143-551 assertions diff against d7af0428 via one constant
// ===========================================================================

// A shallow clone lacks the pinned objects; say so rather than red on an empty diff.
test("precondition: this clone holds the pinned base and merged trunk commits", () => {
  for (const sha of [PINNED, MERGED_TRUNK]) {
    const probe = git(["cat-file", "-e", `${sha}^{commit}`]);
    expect(probe.status, `commit ${sha} is missing from this clone (shallow checkout?) — fetch full history`).toBe(0);
  }
});

describe("AC-STE-672.1 — the 590 suite pins the m143-551 diff to d7af0428 through one named constant", () => {
  test("exactly one named constant in the 590 suite holds d7af0428", () => {
    const decls = [...src590().matchAll(/\bconst\s+([A-Z_][A-Z0-9_]*)\s*(?::\s*[^=]+)?=\s*["'`](d7af0428[0-9a-f]*)["'`]/g)];
    expect(decls.map((m) => m[2]!.slice(0, 8)), "no named constant holds the pinned commit").toEqual([PINNED]);
  });

  test("the m143-551 admission assertion passes that constant, not main", () => {
    const source = src590();
    const name = [...source.matchAll(/\bconst\s+([A-Z_][A-Z0-9_]*)\s*(?::\s*[^=]+)?=\s*["'`]d7af0428/g)][0]?.[1];
    expect(name, "no constant holds d7af0428").toBeDefined();
    const calls = [
      ...source.matchAll(
        /expectUneditedBeyondSte609\(\s*"tests\/m143-ste-551-continuation-offers\.test\.ts"\s*,\s*([^)]+?)\s*\)/g,
      ),
    ].map((m) => m[1]!.trim());
    expect(calls, "the m143-551 admission must name the pinned constant exactly once").toEqual([name!]);
  });

  test("the m143-551 MUTATION test spawns its diff against that constant and never against main", () => {
    const source = src590();
    const name = [...source.matchAll(/\bconst\s+([A-Z_][A-Z0-9_]*)\s*(?::\s*[^=]+)?=\s*["'`]d7af0428/g)][0]?.[1];
    expect(name, "no constant holds d7af0428").toBeDefined();
    const block = mutationBlock(source);
    expect(block).toMatch(new RegExp(`\\[\\s*"diff"\\s*,\\s*"-U0"\\s*,\\s*${name}\\s*,`));
    expect(block, "the MUTATION test still names main as a diff argument").not.toMatch(/["'`]main["'`]/);
  });

  test("the scanner finds no non-empty-diff-against-a-moving-ref assertion in the 590 suite", async () => {
    const { scanSourceForMovingRefDiffAssertions } = await loadScanner();
    expect(scanSourceForMovingRefDiffAssertions(src590(), SUITE_590_REL)).toEqual([]);
  });
});

// ===========================================================================
// AC-STE-672.2 — green on this branch and on merged trunk with the fix applied
// ===========================================================================

describe("AC-STE-672.2 — the m143-551 legs of the 590 suite pass here and on merged trunk 67bdf452", () => {
  test("the pinned diff reads the same from merged trunk as from this branch's tree", () => {
    const fromTrunk = git(["diff", "-U0", PINNED, MERGED_TRUNK, "--", M143_REPO_REL]);
    // The working tree of this branch, measured from the same pinned base.
    const fromHead = git(["diff", "-U0", PINNED, "--", M143_REPO_REL]);
    expect(fromTrunk.status, fromTrunk.stderr).toBe(0);
    expect(fromHead.status, fromHead.stderr).toBe(0);
    expect(fromTrunk.stdout, "no diff from the pinned base on trunk — the pin is wrong").toContain("@@ ");
    expect(fromHead.stdout).toBe(fromTrunk.stdout);
  });

  test("on this branch the 590 suite's m143-551 tests pass", () => {
    const proc = spawnSync("bun", ["test", SUITE_590_REL, "-t", "m143"], {
      cwd: PLUGIN_ROOT,
      encoding: "utf-8",
    });
    const out = `${proc.stdout ?? ""}${proc.stderr ?? ""}`;
    expect(proc.status, out.slice(-4000)).toBe(0);
    expect(out).toMatch(/\b[3-9]\d* pass\b|\b[1-9]\d+ pass\b/);
    expect(out).toMatch(/\b0 fail\b/);
  }, 300_000);

  test("in a temporary checkout of merged trunk 67bdf452 with the fixed suite copied in, the m143-551 tests pass", () => {
    const parent = mkdtempSync(join(tmpdir(), "ste672-trunk-"));
    const wt = join(parent, "wt");
    const add = git(["worktree", "add", "--detach", wt, MERGED_TRUNK]);
    expect(add.status, add.stderr).toBe(0);
    try {
      const wtPlugin = join(wt, "plugins", "dev-process-toolkit");
      copyFileSync(SUITE_590, join(wtPlugin, SUITE_590_REL));
      // The checkout really is trunk: its m143-551 suite equals trunk's bytes.
      const clean = git(["diff", "--quiet", MERGED_TRUNK, "--", M143_REPO_REL], wt);
      expect(clean.status, "the worktree's m143-551 suite is not trunk's").toBe(0);
      const proc = spawnSync("bun", ["test", SUITE_590_REL, "-t", "m143"], {
        cwd: wtPlugin,
        encoding: "utf-8",
      });
      const out = `${proc.stdout ?? ""}${proc.stderr ?? ""}`;
      expect(proc.status, `590 m143 legs red on merged trunk:\n${out.slice(-4000)}`).toBe(0);
      expect(out).toMatch(/\b[3-9]\d* pass\b|\b[1-9]\d+ pass\b/);
      expect(out).toMatch(/\b0 fail\b/);
    } finally {
      git(["worktree", "remove", "--force", wt]);
      rmSync(parent, { recursive: true, force: true });
      git(["worktree", "prune"]);
    }
    expect(existsSync(wt), "the temporary worktree survived teardown").toBe(false);
  }, 400_000);
});

// ===========================================================================
// AC-STE-672.3 — mutations still red against the pinned diff
// ===========================================================================

describe("AC-STE-672.3 — the mutation controls red against the pinned diff", () => {
  const pinnedDiff = (): string => {
    const proc = git(["diff", "-U0", PINNED, "--", M143_REPO_REL]);
    expect(proc.status, proc.stderr).toBe(0);
    return proc.stdout;
  };

  test("the pinned diff is non-empty and every hunk carries the STE-670.4 marker", () => {
    const diff = pinnedDiff();
    expect(diff, "the suite carries no diff against the pinned base").toContain("@@ ");
    expect(unmarked670(diff)).toEqual([]);
  });

  test("stripping the marker from one hunk reports exactly that hunk", () => {
    const diff = pinnedDiff();
    const firstHunk = diff.split(/^(?=@@ )/m).find((h) => h.startsWith("@@ "))!;
    expect((firstHunk.match(/Amended by AC-STE-670\.4/g) ?? []).length).toBe(1);
    const stripped = diff.replace(/Amended by AC-STE-670\.4/, "Amended by nobody");
    expect(unmarked670(stripped)).toEqual([firstHunk.split("\n")[0]!]);
  });

  test("an appended unmarked hunk is reported", () => {
    const extra = `${pinnedDiff()}@@ -999 +999 @@ ctx\n-old line\n+new line\n`;
    expect(unmarked670(extra)).toEqual(["@@ -999 +999 @@ ctx"]);
  });

  test("the 590 suite's own MUTATION test is green on this branch", () => {
    const proc = spawnSync("bun", ["test", SUITE_590_REL, "-t", "MUTATION: an unmarked hunk in the m143-551 diff"], {
      cwd: PLUGIN_ROOT,
      encoding: "utf-8",
    });
    const out = `${proc.stdout ?? ""}${proc.stderr ?? ""}`;
    expect(proc.status, out.slice(-4000)).toBe(0);
    expect(out).toMatch(/\b1 pass\b/);
    expect(out).toMatch(/\b0 fail\b/);
  }, 120_000);
});

// ===========================================================================
// AC-STE-672.4 — the moving-ref non-empty-diff fence
// ===========================================================================

/** Positive: the exact pre-fix shape — diff against main, required non-empty. */
const PLANTED_MAIN = `import { expect, test } from §bun:test§;
import { spawnSync } from §node:child_process§;

test(§edits are graded§, () => {
  const diff = spawnSync(
    §git§,
    [§diff§, §-U0§, §main§, §--§, §tests/some-suite.test.ts§],
    { encoding: §utf-8§ },
  );
  expect(diff.status).toBe(0);
  expect(diff.stdout, §no diff against main§).toContain(§@@ §);
});
`;

/** Positive: HEAD, required non-empty by length. */
const PLANTED_HEAD = `import { expect, test } from §bun:test§;
import { spawnSync } from §node:child_process§;

test(§head diff exists§, () => {
  const proc = spawnSync(§git§, [§diff§, §HEAD§, §--§, §skills/x/SKILL.md§], { encoding: §utf-8§ });
  expect(proc.stdout.length).toBeGreaterThan(0);
});
`;

/** Negatives: unedited-against-main pins, and a non-empty diff against a pinned commit. */
const UNEDITED_MAIN = `import { expect, test } from §bun:test§;
import { spawnSync } from §node:child_process§;

test(§suite is unedited against main§, () => {
  const proc = spawnSync(§git§, [§diff§, §--quiet§, §main§, §--§, §tests/a.test.ts§], { encoding: §utf-8§ });
  expect(proc.status).toBe(0);
});

test(§suite is unedited beyond marked amendments§, () => {
  const diff = spawnSync(§git§, [§diff§, §-U0§, §main§, §--§, §tests/b.test.ts§], { encoding: §utf-8§ });
  expect(diff.status, diff.stderr).toBe(0);
  expect(unmarkedHunks(diff.stdout)).toEqual([]);
});

const PINNED_BASE = §d7af0428§;
test(§pinned diff is graded§, () => {
  const diff = spawnSync(§git§, [§diff§, §-U0§, PINNED_BASE, §--§, §tests/c.test.ts§], { encoding: §utf-8§ });
  expect(diff.stdout).toContain(§@@ §);
});
`;

describe("AC-STE-672.4 — a scan finds tests that require a non-empty diff against main or HEAD", () => {
  test("the real tests/ tree holds none", async () => {
    const { scanMovingRefDiffAssertions } = await loadScanner();
    expect(scanMovingRefDiffAssertions(TESTS_DIR)).toEqual([]);
  });

  test("a planted non-empty-diff-against-main fixture is found, at its assertion line", async () => {
    const { scanMovingRefDiffAssertions } = await loadScanner();
    const dir = mkdtempSync(join(tmpdir(), "ste672-scan-pos-"));
    try {
      const body = decode(PLANTED_MAIN);
      writeFileSync(join(dir, "planted.test.ts"), body);
      const line = body.split("\n").findIndex((l) => l.includes(decode("toContain(§@@ §)"))) + 1;
      const hits = scanMovingRefDiffAssertions(dir);
      expect(hits.length, JSON.stringify(hits)).toBe(1);
      expect(hits[0]!.file.endsWith("planted.test.ts")).toBe(true);
      expect(hits[0]!.line).toBe(line);
      expect(hits[0]!.snippet).toContain(decode("toContain(§@@ §)"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a planted non-empty-diff-against-HEAD fixture is found", async () => {
    const { scanSourceForMovingRefDiffAssertions } = await loadScanner();
    const body = decode(PLANTED_HEAD);
    const hits = scanSourceForMovingRefDiffAssertions(body, "head.test.ts");
    expect(hits.length, JSON.stringify(hits)).toBe(1);
    expect(hits[0]!.file).toBe("head.test.ts");
    expect(hits[0]!.line).toBe(body.split("\n").findIndex((l) => l.includes("toBeGreaterThan(0)")) + 1);
  });

  test("unedited-against-main pins and pinned-commit diffs are not flagged", async () => {
    const { scanMovingRefDiffAssertions, scanSourceForMovingRefDiffAssertions } = await loadScanner();
    const body = decode(UNEDITED_MAIN);
    expect(scanSourceForMovingRefDiffAssertions(body, "unedited.test.ts")).toEqual([]);
    const dir = mkdtempSync(join(tmpdir(), "ste672-scan-neg-"));
    try {
      mkdirSync(join(dir, "nested"));
      writeFileSync(join(dir, "nested", "unedited.test.ts"), body);
      expect(scanMovingRefDiffAssertions(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the pre-fix 590 suite on merged trunk is found by the scan — exactly its MUTATION assertion", async () => {
    const { scanSourceForMovingRefDiffAssertions } = await loadScanner();
    const show = git(["show", `${MERGED_TRUNK}:${SUITE_590_REPO_REL}`]);
    expect(show.status, show.stderr).toBe(0);
    const line =
      show.stdout.split("\n").findIndex((l) => l.includes("the suite carries no diff against main to grade")) + 1;
    expect(line, "control: the pre-fix assertion is in trunk's 590 suite").toBeGreaterThan(0);
    const hits = scanSourceForMovingRefDiffAssertions(show.stdout, SUITE_590_REL);
    expect(hits.map((h) => h.line), JSON.stringify(hits)).toEqual([line]);
  });
});
