// AC-STE-601.12 — the manual's "Recognised command shapes" table is graded by running it.
// AC-STE-601.14 — the real-traffic replay helper exists and never reports an empty corpus as clean.
// AC-STE-601.15 — budgets: no file under skills/ changes in STE-601's own commit range.
//
// TABLE LAYOUT (for the author of docs/hooks-reference.md):
//
//   A heading whose text is exactly `Recognised command shapes` (any level),
//   followed by ONE GFM table with exactly these three columns:
//
//     | Shape | Example | Verdict |
//     |---|---|---|
//     | leading `NAME=value` assignments | `X=1 git -C /s/b commit -m x` | recognised |
//
//   * Example — one runnable command in a code span. Use double backticks
//     (`` echo `cd /s/b && git commit` ``) when the command itself holds a
//     backtick, and `\|` for a literal pipe. It is run through
//     resolveCommitTarget(example, "/s/a") with /s/a and /s/b as the only two
//     checkouts (/s/b/.git belongs to /s/b), with HOME=/s and CDPATH unset.
//   * Verdict — begins with one of: `recognised`, `unplaced`, `out of scope`,
//     `advisory`. Text after the keyword (a reason) is allowed.
//       recognised   → isCommit: true (and, when the verdict says "targets `/s/X`",
//                      repoRoot === /s/X)
//       unplaced     → isCommit: true, repoRoot: null
//       out of scope → isCommit: false, no advisory
//       advisory     → isCommit: false, advisory set
//   * At least 27 rows: one per row of STE-601's shape table.

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveCommitTarget } from "../adapters/_shared/src/commit_target_repo";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const DOC = join(PLUGIN_ROOT, "docs", "hooks-reference.md");

const MAP: Record<string, string> = { "/s/a": "/s/a", "/s/a/sub": "/s/a", "/s/b": "/s/b", "/s/b/sub": "/s/b", "/s/b/.git": "/s/b" };
const ROOTS = (d: string): string | null => MAP[d] ?? null;

interface Row {
  shape: string;
  example: string;
  verdict: string;
}

function splitCells(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === "\\" && line[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (c === "|") {
      cells.push(cur);
      cur = "";
    } else cur += c;
  }
  cells.push(cur);
  return cells.slice(1, -1).map((s) => s.trim());
}

function stripCodeSpan(cell: string): string {
  const m = cell.match(/^(`+)\s?([\s\S]*?)\s?\1$/);
  return m ? m[2]! : cell;
}

export function parseShapesTable(markdown: string): Row[] {
  const lines = markdown.split("\n");
  const h = lines.findIndex((l) => /^#+\s+Recognised command shapes\s*$/.test(l));
  if (h < 0) return [];
  let i = h + 1;
  while (i < lines.length && !lines[i]!.trim().startsWith("|")) {
    if (/^#+\s/.test(lines[i]!)) return [];
    i++;
  }
  const header = splitCells(lines[i] ?? "").map((c) => c.toLowerCase());
  if (header.join(",") !== "shape,example,verdict") return [];
  const rows: Row[] = [];
  for (i += 2; i < lines.length && lines[i]!.trim().startsWith("|"); i++) {
    const [shape, example, verdict] = splitCells(lines[i]!);
    rows.push({ shape: shape ?? "", example: stripCodeSpan(example ?? ""), verdict: (verdict ?? "").toLowerCase() });
  }
  return rows;
}

/**
 * Every row runs with HOME=/s and CDPATH unset, so `~/b` is the checkout /s/b
 * and no row's verdict depends on the machine that grades it.
 */
function withHome<T>(home: string, fn: () => T): T {
  const saved = { HOME: process.env.HOME, CDPATH: process.env.CDPATH };
  process.env.HOME = home;
  delete process.env.CDPATH;
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/**
 * A PR row — one graded by `resolvePrTargetFromPayload`, not by the commit
 * resolver (STE-615 AC.6). Marked in the Verdict cell with the token `(PR)`,
 * because the two resolvers disagree by design about the same command:
 * `gh pr create` is `out of scope` for the commit gates and `recognised` for
 * the PR gate, and one unmarked row cannot carry both answers.
 */
export function isPrRow(row: Row): boolean {
  return row.verdict.includes("(pr)");
}

export function gradeRows(rows: Row[]): string[] {
  const bad: string[] = [];
  for (const row of rows) {
    if (isPrRow(row)) continue;
    const t = withHome("/s", () =>
      resolveCommitTarget(row.example, "/s/a", ROOTS),
    ) as { isCommit: boolean; repoRoot: string | null; advisory?: string | null };
    const adv = Boolean(t.advisory);
    let ok: boolean;
    // A verdict that NAMES its target (`… the commit targets `/s/b``) is graded
    // on that target too, so a row cannot promise a checkout it never resolves to.
    const named = /targets `?(\/s\/[a-z]+)`?/.exec(row.verdict)?.[1];
    if (row.verdict.startsWith("recognised")) ok = t.isCommit && (named === undefined || t.repoRoot === named);
    else if (row.verdict.startsWith("unplaced")) ok = t.isCommit && t.repoRoot === null;
    else if (row.verdict.startsWith("out of scope")) ok = !t.isCommit && !adv;
    else if (row.verdict.startsWith("advisory")) ok = !t.isCommit && adv;
    else ok = false;
    if (!ok) bad.push(`${row.verdict} ← ${row.example} (isCommit=${t.isCommit}, repoRoot=${t.repoRoot}, advisory=${t.advisory ?? null})`);
  }
  return bad;
}

describe("AC-STE-601.12 — the Recognised command shapes table is graded by running it", () => {
  const md = readFileSync(DOC, "utf8");
  const rows = parseShapesTable(md);

  test("the table exists and carries at least 27 rows", () => {
    expect(rows.length).toBeGreaterThanOrEqual(27);
  });

  test("every row has an example and a verdict from the closed vocabulary", () => {
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.example.length).toBeGreaterThan(0);
      expect(row.verdict).toMatch(/^(recognised|unplaced|out of scope|advisory)/);
    }
  });

  test("the table uses every verdict at least once", () => {
    for (const v of ["recognised", "unplaced", "out of scope", "advisory"]) {
      expect({ v, n: rows.filter((r) => r.verdict.startsWith(v)).length > 0 }).toEqual({ v, n: true });
    }
  });

  test("every example resolves to its stated verdict", () => {
    expect(rows.length).toBeGreaterThanOrEqual(27);
    expect(gradeRows(rows)).toEqual([]);
  });

  test("CONTROL — mutating one verdict in a temp copy of the manual turns the grade red", () => {
    const dir = mkdtempSync(join(tmpdir(), "ste601-doc-"));
    try {
      // A COMMIT row: `gradeRows` skips PR rows, so mutating one would leave
      // the grade empty and the control vacuously green (STE-615 AC.6).
      const i = rows.findIndex((r) => r.verdict.startsWith("recognised") && !isPrRow(r));
      expect(i).toBeGreaterThanOrEqual(0);
      const target = rows[i]!;
      const lines = md.split("\n");
      const at = lines.findIndex((l) => l.trim().startsWith("|") && l.includes(target.shape) && /\|\s*recognised/i.test(l));
      expect(at).toBeGreaterThanOrEqual(0);
      lines[at] = lines[at]!.replace(/\|\s*recognised([^|]*)\|\s*$/i, "| out of scope |");
      const copy = join(dir, "hooks-reference.md");
      writeFileSync(copy, lines.join("\n"));
      const mutated = parseShapesTable(readFileSync(copy, "utf8"));
      expect(mutated.length).toBe(rows.length);
      expect(gradeRows(mutated).length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("CONTROL — the parser finds nothing in a document without the heading", () => {
    expect(parseShapesTable("# Other\n\n| Shape | Example | Verdict |\n|---|---|---|\n| x | `git commit` | recognised |\n")).toEqual([]);
    expect(parseShapesTable("## Recognised command shapes\n\n| Shape | Example | Verdict |\n|---|---|---|\n| x | `git commit` | recognised |\n").length).toBe(1);
  });
});

describe("AC-STE-601.14 — the real-traffic replay helper", () => {
  const HELPER = join(PLUGIN_ROOT, "tests", "_command_traffic_replay.ts");

  test("exists, is uncollected, and has an import.meta.main entry", () => {
    expect(existsSync(HELPER)).toBe(true);
    expect(HELPER.endsWith(".test.ts")).toBe(false);
    expect(readFileSync(HELPER, "utf8")).toContain("import.meta.main");
  });

  test("exports its classifier", async () => {
    const mod = (await import(HELPER)) as Record<string, unknown>;
    expect(typeof mod.classifyCommand).toBe("function");
  });

  test("an empty corpus is reported as \"corpus empty, not measured\", never as zero false positives", () => {
    const cfg = mkdtempSync(join(tmpdir(), "ste601-replay-empty-"));
    try {
      mkdirSync(join(cfg, "projects"), { recursive: true });
      const p = spawnSync(process.execPath, ["run", HELPER], {
        env: { ...process.env, CLAUDE_CONFIG_DIR: cfg },
        encoding: "utf8",
        timeout: 120_000,
      });
      expect(p.stdout + p.stderr).toContain("corpus empty, not measured");
    } finally {
      rmSync(cfg, { recursive: true, force: true });
    }
  }, 150_000);

  test("CONTROL — one transcript holding a Bash command is NOT reported as an empty corpus", () => {
    const cfg = mkdtempSync(join(tmpdir(), "ste601-replay-one-"));
    try {
      mkdirSync(join(cfg, "projects", "p"), { recursive: true });
      const line = {
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Bash", input: { command: "command git commit -m x" } }] },
      };
      writeFileSync(join(cfg, "projects", "p", "s.jsonl"), JSON.stringify(line) + "\n");
      const p = spawnSync(process.execPath, ["run", HELPER], {
        env: { ...process.env, CLAUDE_CONFIG_DIR: cfg },
        encoding: "utf8",
        timeout: 120_000,
      });
      expect(p.stdout + p.stderr).not.toContain("corpus empty");
      expect(p.status).toBe(0);
    } finally {
      rmSync(cfg, { recursive: true, force: true });
    }
  }, 150_000);
});

describe("AC-STE-601.15 — budgets: skills/ is untouched BY STE-601", () => {
  const BASE = "ff41e4e42506cd119bf2b8b2866f9654fc113aec";
  /** The commit STE-601 shipped in. Fixed, never a moving ref. */
  const STE_601 = "c88f32f6";

  // SCOPED TO THIS FR'S OWN CHANGE (amended during STE-614). The budget AC.15
  // states is that STE-601 adds nothing under `skills/` — it is this FR's
  // scope, not a freeze on the directory for the rest of the milestone.
  // Measured against the working tree it claimed authority over its siblings:
  // STE-614 AC.11 REQUIRES three files under `skills/` to order the receipt
  // front door, so the unscoped form made two ACs of one milestone
  // unsatisfiable together. The guarantee is unchanged and still falsifiable —
  // a `skills/` edit inside STE-601's own commit range still reds this.
  test("no file under skills/ changed in STE-601's own commit range", () => {
    const p = spawnSync("git", ["diff", "--quiet", BASE, STE_601, "--", "plugins/dev-process-toolkit/skills"], { cwd: REPO_ROOT });
    expect(p.status).toBe(0);
  });

  test("CONTROL — the same diff against the empty tree does see a difference, so the 0 above is not blindness", () => {
    const p = spawnSync(
      "git",
      ["diff", "--quiet", "4b825dc642cb6eb9a060e54bf8d69288fbee4904", BASE, "--", "plugins/dev-process-toolkit/skills"],
      { cwd: REPO_ROOT },
    );
    expect(p.status).toBe(1);
  });
});

describe("AC-STE-613.8 — the shapes table carries the rows of STE-613 items 1 to 6", () => {
  const rows = parseShapesTable(readFileSync(DOC, "utf8"));
  const needles: Array<[string, (ex: string) => boolean]> = [
    ["item 1 — `cd -P`", (ex) => /\bcd -P\b/.test(ex)],
    ["item 1 — `cd --`", (ex) => /\bcd -- /.test(ex)],
    ["item 2 — `builtin cd`", (ex) => ex.includes("builtin cd ")],
    ["item 2 — `command cd`", (ex) => ex.includes("command cd ")],
    ["item 3 — `pushd`", (ex) => /\bpushd\b/.test(ex)],
    ["item 3 — `popd`", (ex) => /\bpopd\b/.test(ex)],
    ["item 4 — `~/`", (ex) => ex.includes("~/")],
    ["item 5 — an in-command `NAME=` binding", (ex) => /(?:^|[;&]\s*)(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*=[^\s;&|]*\s*(?:;|&&)/.test(ex)],
    ["item 6 — `$(pwd)`", (ex) => ex.includes("$(pwd)")],
    ["item 6 — `$(git rev-parse --show-toplevel)`", (ex) => ex.includes("rev-parse --show-toplevel")],
  ];
  for (const [label, has] of needles) {
    test(`a row exemplifies ${label}`, () => {
      expect({ label, present: rows.some((r) => has(r.example)) }).toEqual({ label, present: true });
    });
  }
  test("CONTROL — the needles find nothing in a table without STE-613 rows", () => {
    const only = parseShapesTable("## Recognised command shapes\n\n| Shape | Example | Verdict |\n|---|---|---|\n| x | `cd /s/b && git commit -m x` | recognised |\n");
    expect(only.length).toBe(1);
    for (const [, has] of needles) expect(has(only[0]!.example)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// STE-615 AC.6 — the manual's PR rows are graded by running them through
// `resolvePrTargetFromPayload`, in this same table-driven test.
//
// ROW LAYOUT (for the author of docs/hooks-reference.md): a PR row is an
// ordinary row of the "Recognised command shapes" table whose Verdict cell
// carries the token `(PR)`:
//
//   | `gh pr create` behind a `cd` | `cd /s/b && gh pr create` | recognised (PR) — targets `/s/b` |
//   | `gh pr list` | `gh pr list` | out of scope (PR) — it reads, it creates nothing |
//
//   recognised (PR)   → isPr: true (and, when the verdict says "targets `/s/X`",
//                       repoRoot === /s/X). Known-foreign and unresolved targets
//                       are still PR CREATION, so they are `recognised` too; the
//                       reason after the keyword says which.
//   out of scope (PR) → isPr: false
//
// The commit grader above skips these rows, and this one grades only these.
// ---------------------------------------------------------------------------

export async function gradePrRows(rows: Row[]): Promise<string[]> {
  const { resolvePrTargetFromPayload } = (await import(
    "../adapters/_shared/src/pr_target_repo"
  )) as {
    resolvePrTargetFromPayload: (
      payload: { cwd?: string; tool_input?: { command?: string } },
      roots?: (dir: string) => string | null,
    ) => { isPr: boolean; repoRoot: string | null };
  };
  const bad: string[] = [];
  for (const row of rows) {
    if (!isPrRow(row)) continue;
    const t = withHome("/s", () =>
      resolvePrTargetFromPayload({ cwd: "/s/a", tool_input: { command: row.example } }, ROOTS),
    );
    const named = /targets `?(\/s\/[a-z]+)`?/.exec(row.verdict)?.[1];
    let ok: boolean;
    if (row.verdict.startsWith("recognised")) ok = t.isPr && (named === undefined || t.repoRoot === named);
    else if (row.verdict.startsWith("out of scope")) ok = !t.isPr;
    else ok = false;
    if (!ok) bad.push(`${row.verdict} ← ${row.example} (isPr=${t.isPr}, repoRoot=${t.repoRoot})`);
  }
  return bad;
}

describe("AC-STE-615.6 — the manual's PR rows are graded by running them", () => {
  const rows = parseShapesTable(readFileSync(DOC, "utf8"));
  const prRows = rows.filter(isPrRow);

  test("the table carries at least 11 PR rows", () => {
    expect(prRows.length).toBeGreaterThanOrEqual(11);
  });

  test("every PR row's verdict comes from the closed vocabulary", () => {
    expect(prRows.length).toBeGreaterThan(0);
    for (const row of prRows) {
      expect(row.example.length).toBeGreaterThan(0);
      expect(row.verdict).toMatch(/^(recognised|out of scope)/);
    }
    // Both verdicts are used: a table that only forbids, or only permits,
    // grades one direction.
    for (const v of ["recognised", "out of scope"]) {
      expect({ v, used: prRows.some((r) => r.verdict.startsWith(v)) }).toEqual({ v, used: true });
    }
  });

  test("every PR example resolves to its stated verdict", async () => {
    expect(prRows.length).toBeGreaterThanOrEqual(11);
    expect(await gradePrRows(prRows)).toEqual([]);
  });

  const needles: Array<[string, (ex: string) => boolean]> = [
    ["a bare `gh pr create`", (ex) => /^gh pr create\b/.test(ex)],
    ["a `cd` prefix", (ex) => /\bcd .*gh pr (create|new)\b/.test(ex)],
    ["`-R` or `--repo`", (ex) => /gh .*(-R |--repo)/.test(ex)],
    ["a `GH_REPO=` binding", (ex) => /GH_REPO=/.test(ex)],
    ["gh's `new` alias", (ex) => /\bgh pr new\b/.test(ex)],
    ["a command substitution", (ex) => /\$\(gh pr create/.test(ex)],
    ["`--help`", (ex) => /gh pr create .*-{1,2}h(elp)?\b/.test(ex)],
    ["`gh pr list`", (ex) => /\bgh pr list\b/.test(ex)],
    ["`gh api …/pulls`", (ex) => /gh api .*pulls/.test(ex)],
    ["`hub pull-request`", (ex) => /\bhub pull-request\b/.test(ex)],
    ["`git push -o merge_request.create`", (ex) => /merge_request\.create/.test(ex)],
  ];
  for (const [label, has] of needles) {
    test(`a PR row exemplifies ${label}`, () => {
      expect({ label, present: prRows.some((r) => has(r.example)) }).toEqual({ label, present: true });
    });
  }

  test("CONTROL — the PR grader is blind to the commit rows, and the commit grader to these", () => {
    const only = parseShapesTable(
      "## Recognised command shapes\n\n| Shape | Example | Verdict |\n|---|---|---|\n" +
        "| bare | `gh pr create` | recognised (PR) |\n" +
        "| bare commit | `git -C /s/b commit -m x` | recognised |\n",
    );
    expect(only.length).toBe(2);
    expect(only.filter(isPrRow).length).toBe(1);
    // The commit grader sees one row here, and it is the commit one.
    expect(gradeRows(only)).toEqual([]);
  });
});
