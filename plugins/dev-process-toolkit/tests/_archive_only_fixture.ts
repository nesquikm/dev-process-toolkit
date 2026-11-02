// STE-700 shared fixture helper — synthetic spec files, as the archive flow
// leaves them, and temporary git checkouts that carry them.
//
// Leading underscore: a helper module, never collected as a suite.
//
// Every id here is synthetic (FX-1, M_fx0001). The archived shapes mirror what
// skills/implement/SKILL.md § Milestone Archival writes: the frontmatter
// `status` / `archived_at` flip, plan checkboxes ticked, a `## Implementation
// notes` section placed after `## Notes`, the token-stats marker block
// refreshed, and one `| AC-` traceability row appended to specs/requirements.md.

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const FR_ACTIVE_PATH = "specs/frs/FX-1.md";
export const FR_ARCHIVE_PATH = "specs/frs/archive/FX-1.md";
export const PLAN_ACTIVE_PATH = "specs/plan/M_fx0001.md";
export const PLAN_ARCHIVE_PATH = "specs/plan/archive/M_fx0001.md";
export const REQUIREMENTS_PATH = "specs/requirements.md";

const SUMMARY = [
  "The fixture requirement describes a small synthetic behaviour.",
  "It exists only so a classifier has realistic text to compare.",
  "Each line here is stable across the archive move.",
  "A rename detector needs most of the file to survive the edit.",
  "So the summary carries a handful of plain sentences.",
  "None of them is touched by the archive flow.",
  "An edit to any of them is outside the allowed set.",
  "That is the whole point of keeping them here.",
];

export interface FrOptions {
  status?: string;
  archivedAt?: string;
  milestone?: string;
  summary?: string[];
  implementationNotes?: boolean;
  tokenRows?: string[];
}

const TOKEN_HEADER = [
  "| skill | model | input | output | cache-read | cache-creation |",
  "| --- | --- | ---: | ---: | ---: | ---: |",
];
export const TOKEN_ROWS_EMPTY = ["| subtotal |  | 0 | 0 | 0 | 0 |"];
export const TOKEN_ROWS_FILLED = [
  "| implement | fixture-model | 10 | 20 | 30 | 40 |",
  "| subtotal |  | 10 | 20 | 30 | 40 |",
];

export function frText(o: FrOptions = {}): string {
  const lines = [
    "---",
    "title: Fixture requirement one",
    `milestone: ${o.milestone ?? "M_fx0001"}`,
    `status: ${o.status ?? "active"}`,
    `archived_at: ${o.archivedAt ?? "null"}`,
    "tracker:",
    "  linear: FX-1",
    "created_at: 2026-01-01T00:00:00Z",
    "---",
    "",
    "# Fixture requirement one",
    "",
    "## Summary",
    "",
    ...(o.summary ?? SUMMARY),
    "",
    "## Acceptance Criteria",
    "",
    "- AC-FX-1.1: the first criterion holds.",
    "- AC-FX-1.2: the second criterion holds.",
    "",
    "## Notes",
    "",
    "Origin: a synthetic fixture.",
    "",
    ...(o.implementationNotes
      ? ["## Implementation notes", "", "No advisory notes.", ""]
      : []),
    "<!-- token-stats:begin -->",
    "",
    "## Token Stats",
    "",
    ...TOKEN_HEADER,
    ...(o.tokenRows ?? TOKEN_ROWS_EMPTY),
    "",
    "<!-- token-stats:end -->",
  ];
  return lines.join("\n") + "\n";
}

export const ARCHIVED_AT = "2026-11-02T10:11:12Z";

/** The FR exactly as the archive flow leaves it. */
export function frArchivedText(o: FrOptions = {}): string {
  return frText({
    status: "archived",
    archivedAt: ARCHIVED_AT,
    implementationNotes: true,
    tokenRows: TOKEN_ROWS_FILLED,
    ...o,
  });
}

export interface PlanOptions {
  status?: string;
  archivedAt?: string;
  tasks?: string[];
}

export const PLAN_TASKS_OPEN = [
  "- [ ] task one: write the thing",
  "- [ ] task two: test the thing",
  "- [ ] task three: ship the thing",
];
export const PLAN_TASKS_TICKED = PLAN_TASKS_OPEN.map((t) => t.replace("- [ ]", "- [x]"));

export function planText(o: PlanOptions = {}): string {
  const lines = [
    "---",
    "milestone: M_fx0001",
    `status: ${o.status ?? "active"}`,
    `archived_at: ${o.archivedAt ?? "null"}`,
    "---",
    "",
    "# M_fx0001 — Fixture milestone",
    "",
    "## Tasks",
    "",
    ...(o.tasks ?? PLAN_TASKS_OPEN),
    "",
    "## Notes",
    "",
    "The plan exists only so the archive classifier has a plan to move.",
    "Its prose is stable across the archive move.",
    "A rename detector needs most of the file to survive the edit.",
    "These lines make sure it does.",
  ];
  return lines.join("\n") + "\n";
}

export function planArchivedText(o: PlanOptions = {}): string {
  return planText({ status: "archived", archivedAt: ARCHIVED_AT, tasks: PLAN_TASKS_TICKED, ...o });
}

export const REQ_ROWS_BASE = [
  "| AC-FX-0.1..3 | src/zero.ts | tests/zero.test.ts |",
];
export const REQ_ROW_NEW = "| AC-FX-1.1..2 | src/app.ts | tests/app.test.ts |";

export function requirementsText(rows: string[] = REQ_ROWS_BASE, intro = "Fixture requirements."): string {
  return [
    "# Requirements",
    "",
    intro,
    "",
    "## 6. Traceability Matrix",
    "",
    "| AC | Implementation | Tests |",
    "| --- | --- | --- |",
    ...rows,
  ].join("\n") + "\n";
}

// ------------------------------------------------------------- unified diffs
//
// The classifier takes name-status entries plus each file's unified diff. The
// pure tables build those diffs from (before, after) text here, in git's own
// layout and with FULL-FILE context, so every row reads as two documents
// rather than a hand-typed hunk.

type Op = [" " | "-" | "+", string];

function splitLines(t: string): string[] {
  if (t === "") return [];
  const ls = t.split("\n");
  if (ls[ls.length - 1] === "") ls.pop();
  return ls;
}

function lineDiff(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push([" ", a[i]!]);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push(["-", a[i]!]);
      i++;
    } else {
      ops.push(["+", b[j]!]);
      j++;
    }
  }
  while (i < n) ops.push(["-", a[i++]!]);
  while (j < m) ops.push(["+", b[j++]!]);
  return ops;
}

function hunk(before: string, after: string): string[] {
  const a = splitLines(before);
  const b = splitLines(after);
  const ops = lineDiff(a, b);
  const head = `@@ -${a.length === 0 ? "0,0" : `1,${a.length}`} +${b.length === 0 ? "0,0" : `1,${b.length}`} @@`;
  return [head, ...ops.map(([k, l]) => `${k}${l}`)];
}

/** A change entry in the classifier's input shape. */
export interface FixtureChange {
  status: string;
  path: string;
  oldPath?: string;
  diff: string;
}

export function modified(path: string, before: string, after: string): FixtureChange {
  return {
    status: "M",
    path,
    diff: [
      `diff --git a/${path} b/${path}`,
      "index 1111111..2222222 100644",
      `--- a/${path}`,
      `+++ b/${path}`,
      ...hunk(before, after),
    ].join("\n") + "\n",
  };
}

export function renamed(
  from: string,
  to: string,
  before: string,
  after: string,
  status = "R090",
): FixtureChange {
  const header = [
    `diff --git a/${from} b/${to}`,
    `similarity index ${before === after ? 100 : Number(status.slice(1)) || 90}%`,
    `rename from ${from}`,
    `rename to ${to}`,
  ];
  const body =
    before === after
      ? []
      : ["index 1111111..2222222 100644", `--- a/${from}`, `+++ b/${to}`, ...hunk(before, after)];
  return {
    status: before === after ? "R100" : status,
    path: to,
    oldPath: from,
    diff: [...header, ...body].join("\n") + "\n",
  };
}

export function added(path: string, text: string): FixtureChange {
  return {
    status: "A",
    path,
    diff: [
      `diff --git a/${path} b/${path}`,
      "new file mode 100644",
      "index 0000000..2222222",
      "--- /dev/null",
      `+++ b/${path}`,
      ...hunk("", text),
    ].join("\n") + "\n",
  };
}

export function deleted(path: string, text: string): FixtureChange {
  return {
    status: "D",
    path,
    diff: [
      `diff --git a/${path} b/${path}`,
      "deleted file mode 100644",
      "index 1111111..0000000",
      `--- a/${path}`,
      "+++ /dev/null",
      ...hunk(text, ""),
    ].join("\n") + "\n",
  };
}

// --------------------------------------------------------------- git repos

export function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf-8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.invalid",
      GIT_COMMITTER_NAME: "Fixture",
      GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    },
  });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${r.stderr}`);
  }
  return r.stdout;
}

export function writeAt(root: string, rel: string, text: string): void {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
}

/**
 * A fresh toolkit-managed checkout on `main` holding the ACTIVE FR, the ACTIVE
 * plan, specs/requirements.md and one source file, committed.
 *
 * `diff.renames` is switched OFF in the checkout's own config, so a reader
 * that leans on git's default rename detection sees a move as a delete plus an
 * add: AC-STE-700.7 says the classifier turns rename detection on itself.
 */
export function makeArchiveRepo(dir: string): string {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.name", "Fixture");
  git(dir, "config", "user.email", "fixture@example.invalid");
  git(dir, "config", "commit.gpgsign", "false");
  git(dir, "config", "diff.renames", "false");
  writeAt(
    dir,
    "CLAUDE.md",
    ["# Fixture Project", "", "## Task Tracking", "", "mode: none", "", "## Verification", "", "run_cmd: none", ""].join("\n"),
  );
  writeAt(dir, FR_ACTIVE_PATH, frText());
  writeAt(dir, PLAN_ACTIVE_PATH, planText());
  writeAt(dir, REQUIREMENTS_PATH, requirementsText());
  writeAt(dir, "src/app.ts", "export const app = 1;\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "chore: fixture base");
  return dir;
}

/** The archive move exactly as the archive flow performs it, left in the working tree + index. */
export function applyArchiveMove(dir: string, frAfter = frArchivedText()): void {
  mkdirSync(join(dir, dirname(FR_ARCHIVE_PATH)), { recursive: true });
  mkdirSync(join(dir, dirname(PLAN_ARCHIVE_PATH)), { recursive: true });
  git(dir, "mv", FR_ACTIVE_PATH, FR_ARCHIVE_PATH);
  git(dir, "mv", PLAN_ACTIVE_PATH, PLAN_ARCHIVE_PATH);
  writeAt(dir, FR_ARCHIVE_PATH, frAfter);
  writeAt(dir, PLAN_ARCHIVE_PATH, planArchivedText());
  writeAt(dir, REQUIREMENTS_PATH, requirementsText([...REQ_ROWS_BASE, REQ_ROW_NEW]));
  git(dir, "add", "-A");
}
