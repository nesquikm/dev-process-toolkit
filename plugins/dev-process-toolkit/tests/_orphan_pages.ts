// Shared fixtures for STE-605 (M_947c79) — the orphan listing, its consent and
// probe #49 over saved two-repo container pages.
//
// Leading underscore: a helper module, never collected as a suite. Consumers:
// `tests/orphan-listing-shared.test.ts` and
// `tests/gate-check-tracker-local-reconciliation-drift.test.ts`.
//
// ---------------------------------------------------------------------------
// OUTPUT CONTRACT the consumers read (the FR fixes the fields; this file fixes
// the framing — the implementer satisfies exactly this):
// ---------------------------------------------------------------------------
//   `container_ownership.ts list <root> <page.json>...`
//     - one TABLE ROW per unbound ticket read (excluded classes included):
//         `| <KEY> | <class> | <owner> | <toolkit-written> | <title> |`
//       class is one of `ours | sibling | unowned | container` when shared.
//     - ONE SUMMARY LINE starting `summary:` carrying
//         `read=<n> ours=<n> sibling=<n> unowned=<n> containers=<n> bound=<n> complete=<true|false>`
//       plus the word `excluded` for the excluded classes. The counts
//       PARTITION the tickets read: read = ours + sibling + unowned +
//       containers + bound (the class counts are over UNBOUND tickets).
//     - for each OFFERABLE ticket the two option labels `Import <KEY>` and
//       `Skip <KEY>`; nothing else prints `Import <KEY>`.
//     - a refusal exits non-zero, names the file or key on stderr, and prints
//       no table row and no option label.
//   `container_ownership.ts consent <root> <key> <page.json>...`
//     - shared + `ours`/`unowned`: exit 0, one `dpt-receipt: <path>` line, an
//       `import` receipt whose subject is the key.
//     - `sibling`, `container`, or a key absent from the pages: exit non-zero,
//       zero files written.
//     - undeclared: exit 0, no receipt line, zero files written.
//   `tracker_local_reconciliation_drift.ts <root> <page.json>...`
//     - one line per row; a row names its kind token (`tracker-orphan`,
//       `unowned-container-ticket`, `bound-ticket-untagged`,
//       `numeric-milestone-shared`, `container-not-read`, `container-empty`,
//       `container-partial`) and every key it is about, on that line.
//     - when pages were read, one info line containing the word `excluded`.
//
// In-process shapes the consumers use:
//   - `runTrackerLocalReconciliationDriftProbe(root, { provider, containerPages })`
//     where `containerPages` is the PARSED page JSON (`unknown[]`).
//   - `importFromTracker(key, id, provider, specsDir, promptMilestone, { projectRoot, pages })`
//     — the optional sixth argument (parsed pages) turns on the ownership
//     check and, in a shared repository, the tag-on-import.

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { claudeMd } from "./_span_fixture";

export const PLUGIN_ROOT = join(import.meta.dir, "..");
export const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
export const OWNERSHIP_MODULE = join(PLUGIN_ROOT, "adapters", "_shared", "src", "container_ownership.ts");
export const DRIFT_MODULE = join(PLUGIN_ROOT, "adapters", "_shared", "src", "tracker_local_reconciliation_drift.ts");

export const FE_TAG = "glacy-fe";
export const BE_TAG = "glacy-be";

// ------------------------------------------------------------ declarations

/** Jira GF, shared with `tag` (default labels `[tag, ...extra]`), or undeclared when null. */
export function declareJira(root: string, tag: string | null, extraDefaults: string[] = []): void {
  if (tag === null) claudeMd(root, { mode: "jira", project: "GF" });
  else {
    claudeMd(root, {
      mode: "jira",
      project: "GF",
      defaultLabels: [tag, ...extraDefaults],
      repoTag: tag,
      minDptVersion: "2.87.0",
    });
  }
}

export function declareLinear(root: string, tag: string | null): void {
  if (tag === null) claudeMd(root, { mode: "linear", team: "STE", project: "DPT" });
  else {
    claudeMd(root, {
      mode: "linear",
      team: "STE",
      project: "DPT",
      defaultLabels: [tag],
      repoTag: tag,
      minDptVersion: "2.87.0",
    });
  }
}

/** A local FR under `<root>/specs/frs/<key>.md` bound to `key` on `trackerKey`. */
export function boundFr(root: string, key: string, trackerKey: "jira" | "linear" = "jira"): void {
  mkdirSync(join(root, "specs", "frs"), { recursive: true });
  writeFileSync(
    join(root, "specs", "frs", `${key}.md`),
    [
      "---",
      `title: ${key}`,
      "milestone: M_GF_85",
      "status: active",
      "archived_at: null",
      "tracker:",
      `  ${trackerKey}: ${key}`,
      "created_at: 2026-09-18T00:00:00Z",
      "---",
      "",
      `# ${key}`,
      "",
    ].join("\n"),
  );
}

// ------------------------------------------------------------------ tickets

export interface Ticket {
  key: string;
  title: string;
  labels: string[];
  /** Jira issue type; `Epic` is a container. */
  type?: string;
  creator: string;
  /** True when the description carries `Source: specs/frs/<key>.md`. */
  backLink?: boolean;
}

export const backLinkLine = (key: string) => `Source: specs/frs/${key}.md`;

export function description(t: Ticket): string {
  return t.backLink ? `Some body text.\n\n${backLinkLine(t.key)}` : "Filed by hand from the board.";
}

/** One Jira search row, as `searchJiraIssuesUsingJql` returns it. */
export function jiraIssue(t: Ticket): Record<string, unknown> {
  const epic = (t.type ?? "Task") === "Epic";
  return {
    key: t.key,
    fields: {
      summary: t.title,
      labels: [...t.labels],
      issuetype: { name: t.type ?? "Task", hierarchyLevel: epic ? 1 : 0 },
      project: { key: "GF" },
      creator: { displayName: t.creator },
      description: description(t),
    },
  };
}

export function jiraPage(tickets: Ticket[], isLast = true) {
  return { issues: tickets.map(jiraIssue), isLast };
}

/** One Linear `list_issues` row. */
export function linearIssue(t: Ticket): Record<string, unknown> {
  return {
    id: t.key,
    identifier: t.key,
    title: t.title,
    labels: [...t.labels],
    description: description(t),
    createdBy: t.creator,
    project: "DPT",
    team: "STE",
  };
}

export function linearPage(tickets: Ticket[], hasNextPage = false) {
  return { issues: tickets.map(linearIssue), pageInfo: { hasNextPage, endCursor: null } };
}

// The two-repo Jira container of AC-STE-605.1.
export const FE_TICKETS: Ticket[] = [
  { key: "GF-101", title: "FE reward banner", labels: [FE_TAG], creator: "Fe Dev", backLink: true },
  { key: "GF-102", title: "FE streak timer", labels: [FE_TAG], creator: "Fe Dev", backLink: true },
];
export const BE_TICKETS: Ticket[] = [
  { key: "GF-111", title: "BE reward ledger", labels: [BE_TAG], creator: "Be Dev", backLink: true },
  { key: "GF-112", title: "BE streak cron", labels: [BE_TAG], creator: "Be Dev", backLink: true },
];
export const HAND_FILED: Ticket[] = [
  { key: "GF-121", title: "Crash on login", labels: [], creator: "Pat Manager" },
  { key: "GF-122", title: "Typo on paywall", labels: [], creator: "Quinn Support" },
];
/** A pre-tagging client with no default labels: back-link, no labels. */
export const OLD_CLIENT: Ticket = {
  key: "GF-131",
  title: "Legacy import flow",
  labels: [],
  creator: "Old Client",
  backLink: true,
};
/** Hand-filed, hand-tagged with BE's tag only. */
export const HAND_TAGGED_BE: Ticket = {
  key: "GF-141",
  title: "Rate limiter tuning",
  labels: [BE_TAG],
  creator: "Pat Manager",
};
export const EPICS: Ticket[] = [
  { key: "GF-85", title: "M_GF_85 Rewards", labels: [FE_TAG], type: "Epic", creator: "Lead" },
  { key: "GF-89", title: "M_GF_89 Streaks", labels: [], type: "Epic", creator: "Lead" },
];

export const TWO_REPO: Ticket[] = [
  ...FE_TICKETS,
  ...BE_TICKETS,
  ...HAND_FILED,
  OLD_CLIENT,
  HAND_TAGGED_BE,
  ...EPICS,
];

export const keysOf = (ts: Ticket[]) => ts.map((t) => t.key);

// ------------------------------------------------------------------ running

export interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

export function spawnModule(module: string, args: string[], env: Record<string, string>): Run {
  const proc = Bun.spawnSync(["bun", "run", module, ...args], {
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: proc.exitCode ?? -1,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

const KEY_RE = /^[A-Z][A-Z0-9]*-\d+$/;
const KEY_IN_TEXT_RE = /\b[A-Z][A-Z0-9]*-\d+\b/g;

export interface TableRow {
  key: string;
  cls: string;
  owner: string;
  cells: string[];
}

/** Every `| <KEY> | <class> | <owner> | ... |` row. */
export function tableRows(stdout: string): TableRow[] {
  const out: TableRow[] = [];
  for (const line of stdout.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("|")) continue;
    const cells = t.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 3 || !KEY_RE.test(cells[0]!)) continue;
    out.push({ key: cells[0]!, cls: cells[1]!, owner: cells[2]!, cells });
  }
  return out;
}

/** key -> class, from the table. */
export function classes(stdout: string): Map<string, string> {
  return new Map(tableRows(stdout).map((r) => [r.key, r.cls]));
}

/** Keys of every class `cls`, sorted. */
export function keysOfClass(stdout: string, cls: string): string[] {
  return tableRows(stdout)
    .filter((r) => r.cls === cls)
    .map((r) => r.key)
    .sort();
}

/** Keys the listing offers: `Import <KEY>` option labels. */
export function offered(stdout: string): string[] {
  const keys = new Set<string>();
  for (const m of stdout.matchAll(/\bImport ([A-Z][A-Z0-9]*-\d+)\b/g)) keys.add(m[1]!);
  return [...keys].sort();
}

export interface Summary {
  line: string;
  counts: Record<string, number>;
  complete: boolean | undefined;
}

export function summary(stdout: string): Summary | null {
  const line = stdout.split("\n").find((l) => l.trim().startsWith("summary:"));
  if (line === undefined) return null;
  const counts: Record<string, number> = {};
  for (const m of line.matchAll(/\b(read|ours|sibling|unowned|containers|bound)=(\d+)/g)) {
    counts[m[1]!] = Number(m[2]);
  }
  const c = /\bcomplete=(true|false|yes|no)\b/.exec(line);
  return { line, counts, complete: c ? c[1] === "true" || c[1] === "yes" : undefined };
}

/** Lines of the probe output that carry `kind` and at least one ticket key. */
export function probeRows(stdout: string, kind: string): string[] {
  return stdout.split("\n").filter((l) => l.includes(kind) && (l.match(KEY_IN_TEXT_RE) ?? []).length > 0);
}

/** Every key named on a row of `kind`. */
export function probeRowKeys(stdout: string, kind: string): string[] {
  const keys = new Set<string>();
  for (const row of probeRows(stdout, kind)) for (const k of row.match(KEY_IN_TEXT_RE) ?? []) keys.add(k);
  return [...keys].sort();
}

/**
 * Every file under `root` (the working tree), relative path -> bytes. `.git`
 * is skipped: the claims graded here are about the working tree, and git's own
 * background maintenance creates and removes lock files under `.git` while a
 * walk is in flight (a measured ENOENT flake in the STE-606 join-path test).
 */
export function snapshotTree(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === ".git") continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.set(relative(root, p), readFileSync(p, "utf-8"));
    }
  };
  walk(root);
  return out;
}
