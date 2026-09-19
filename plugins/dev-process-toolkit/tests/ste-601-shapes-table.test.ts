// AC-STE-601.12 — the manual's "Recognised command shapes" table is graded by running it.
// AC-STE-601.14 — the real-traffic replay helper exists and never reports an empty corpus as clean.
// AC-STE-601.15 — budgets: no file under skills/ changes against the milestone's fixed base.
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
//     checkouts (/s/b/.git belongs to /s/b).
//   * Verdict — begins with one of: `recognised`, `unplaced`, `out of scope`,
//     `advisory`. Text after the keyword (a reason) is allowed.
//       recognised   → isCommit: true
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

export function gradeRows(rows: Row[]): string[] {
  const bad: string[] = [];
  for (const row of rows) {
    const t = resolveCommitTarget(row.example, "/s/a", ROOTS) as { isCommit: boolean; repoRoot: string | null; advisory?: string | null };
    const adv = Boolean(t.advisory);
    let ok: boolean;
    if (row.verdict.startsWith("recognised")) ok = t.isCommit;
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
      const i = rows.findIndex((r) => r.verdict.startsWith("recognised"));
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

describe("AC-STE-601.15 — budgets: skills/ is untouched", () => {
  const BASE = "ff41e4e42506cd119bf2b8b2866f9654fc113aec";

  test("no file under skills/ differs from the milestone's fixed base (working tree included)", () => {
    const p = spawnSync("git", ["diff", "--quiet", BASE, "--", "plugins/dev-process-toolkit/skills"], { cwd: REPO_ROOT });
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
