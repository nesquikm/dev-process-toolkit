// Shared fixture for STE-612 — the repoint command (`repoint_tracker_binding.ts`).
//
// Leading underscore: a helper module, never collected as a suite.
//
// THE MEASURED SHAPE. The fixture is built from the Glacy pair the FR was
// measured against: root A is `glacy-app-be`, bound to Jira project `GB`,
// shared under tag `glacy-be`; root B is its peer `glacy-app-fe`, bound to `GF`
// under tag `glacy-fe`. A carries a tracker config, archived numeric plans
// M1..M39 and three archived FRs keyed `GB-*`; B names the same Atlassian
// server under a second spelling. Both roots are REAL git repositories
// (`makeSpanFixture`), so row 8 can read branches and worktrees.
//
// LISTING SHAPES (the raw MCP answers the session saves to files and passes in):
//
//   --projects     Jira  getVisibleJiraProjects      { self, maxResults, startAt, total, isLast, values: [{ id, key, name }] }
//                                                    (measured; complete iff isLast)
//                  Linear list_projects              { projects: [{ id, name, status }], hasNextPage } (measured;
//                                                    read by tracker_answer.ts and proven its last page)
//   --containers   Jira  Epic search (STE-608)       { issues: [{ key, fields: { summary, project: { key },
//                                                      issuetype: { name: "Epic" }, status: {...} } }], isLast: true }
//                  Linear list_milestones (STE-608)  { milestones: [{ id, name, description, progress, sortOrder }] }
//                                                    (measured; a full 50-row window is not complete)
//                  — both parsed by `readListingFile` of resolve_milestone_identity.ts.
//   --issue-types  Jira  getJiraProjectIssueTypesMetadata  { startAt, maxResults, total, issueTypes: [{ id, name }] }
//                                                    (measured; complete iff startAt 0 and `total` rows)
//   --statuses     Linear list_issue_statuses        a BARE array [{ id, type, name }] (measured)
//                  Jira  (no MCP tool lists them)    { statuses: [{ id, name }], isLast: true } — hand-assembled,
//                                                    its completeness ASSERTED by the session
//   --labels       Jira  (no MCP tool lists them)    { values: ["label", ...], isLast: true } — hand-assembled,
//                                                    its completeness ASSERTED by the session
//
// Every git call runs under GIT_ENV (GIT_CONFIG_GLOBAL=/dev/null). Spawns are
// synchronous, one at a time, so no concurrency cap is needed.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { receiptsDir } from "../adapters/_shared/src/dpt_paths";
import { runningDptVersion } from "../adapters/_shared/src/dpt_version";
import { renderSharedTrackerSentinel } from "../adapters/_shared/src/setup/tracker_binding_write";
import { commitAll, GIT_ENV, makeSpanFixture } from "./_span_fixture";

export const PLUGIN_ROOT = join(import.meta.dir, "..");
export const FRONT_DOOR = join(PLUGIN_ROOT, "adapters", "_shared", "src", "repoint_tracker_binding.ts");
export const ATLASSIAN_URL = "https://mcp.atlassian.com/v1/sse";
export const LINEAR_URL = "https://mcp.linear.app/sse";
export const SESSION_ID = `ste612-${process.pid}-${Date.now()}`;

/** The measured status vocabularies: GB's hand-written file, GF's listing. */
export const GB_CONFIG_STATUSES = ["To Do", "In Progress", "In Review", "Done"];
export const GF_STATUSES = ["To Do", "In Progress", "Done"];

// ------------------------------------------------------------------ CLAUDE.md

export interface JiraMdOpts {
  project: string;
  repoTag?: string;
  /** Default: the running toolkit version, read, never typed. */
  minDptVersion?: string;
  issueType?: string;
  mcpServer?: string;
  defaultLabels?: string[];
  /** "render" (default when a tag is declared): the byte-exact render for project/tag/floor; "none": omitted; else verbatim text. */
  paragraph?: "render" | "none" | string;
  mode?: string;
}

export function jiraClaudeMdText(o: JiraMdOpts): string {
  const floor = o.repoTag !== undefined ? (o.minDptVersion ?? runningDptVersion()) : o.minDptVersion;
  const lines = [
    "# Fixture Project",
    "",
    "## Task Tracking",
    "",
    `mode: ${o.mode ?? "jira"}`,
    `mcp_server: ${o.mcpServer ?? "atlassian"}`,
    "",
    "### Jira",
    "",
    `project: ${o.project}`,
  ];
  const labels = o.defaultLabels ?? (o.repoTag !== undefined ? [o.repoTag] : undefined);
  if (labels !== undefined) lines.push(`default_labels: [${labels.join(", ")}]`);
  if (o.repoTag !== undefined) lines.push(`repo_tag: ${o.repoTag}`);
  if (floor !== undefined) lines.push(`min_dpt_version: ${floor}`);
  if (o.issueType !== undefined) lines.push(`jira_issue_type: ${o.issueType}`);
  const para = o.paragraph ?? (o.repoTag !== undefined ? "render" : "none");
  if (para === "render") {
    lines.push(
      "",
      renderSharedTrackerSentinel({ adapter: "jira", project: o.project, repoTag: o.repoTag!, minDptVersion: floor! }),
    );
  } else if (para !== "none") {
    lines.push("", para);
  }
  lines.push("", "## Verification", "", "run_cmd: none", "");
  return lines.join("\n");
}

export interface LinearMdOpts {
  team: string;
  project: string;
  mcpServer?: string;
}

export function linearClaudeMdText(o: LinearMdOpts): string {
  return [
    "# Fixture Project",
    "",
    "## Task Tracking",
    "",
    "mode: linear",
    `mcp_server: ${o.mcpServer ?? "linear"}`,
    "",
    "### Linear",
    "",
    `team: ${o.team}`,
    `project: ${o.project}`,
    "",
    "## Verification",
    "",
    "run_cmd: none",
    "",
  ].join("\n");
}

// ------------------------------------------------------------------ repo files

export function writeMcpJson(root: string, entries: Record<string, string>): void {
  const servers: Record<string, unknown> = {};
  for (const [name, url] of Object.entries(entries)) servers[name] = { type: "http", url };
  writeFileSync(join(root, ".mcp.json"), `${JSON.stringify({ mcpServers: servers }, null, 2)}\n`);
}

export function trackerConfigText(trackerKey: string, statuses: string[]): string {
  const initial = statuses[0]!;
  const done = statuses[statuses.length - 1]!;
  const inProgress = statuses.find((s) => /progress/i.test(s)) ?? initial;
  const inReview = statuses.find((s) => /review/i.test(s)) ?? inProgress;
  return [
    `tracker_key: ${trackerKey}`,
    "statuses:",
    ...statuses.map((s) => `  - ${s}`),
    "roles:",
    `  initial: ${initial}`,
    `  in_progress: ${inProgress}`,
    `  in_review: ${inReview}`,
    `  done: ${done}`,
    "",
  ].join("\n");
}

export function writeTrackerConfig(root: string, trackerKey: string, statuses: string[]): void {
  mkdirSync(join(root, "specs"), { recursive: true });
  writeFileSync(join(root, "specs", "tracker-config.yaml"), trackerConfigText(trackerKey, statuses));
}

/** A plan file: active under specs/plan/, archived under specs/plan/archive/. */
export function writePlan(root: string, token: string, status: "active" | "archived", title = "Fixture"): string {
  const dir = status === "active" ? join(root, "specs", "plan") : join(root, "specs", "plan", "archive");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${token}.md`);
  writeFileSync(
    path,
    [
      "---",
      `milestone: ${token}`,
      `status: ${status}`,
      `archived_at: ${status === "archived" ? "2026-09-10T00:00:00Z" : "null"}`,
      "shipped_in: null",
      "---",
      "",
      `## ${token} — ${title}`,
      "",
    ].join("\n"),
  );
  return path;
}

/** A tracker-bound FR, file named by its key. Title and heading never carry the key. */
export function writeFr(
  root: string,
  key: string,
  milestone: string,
  status: "active" | "archived",
  tracker: "jira" | "linear" = "jira",
): string {
  const dir = status === "active" ? join(root, "specs", "frs") : join(root, "specs", "frs", "archive");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${key}.md`);
  writeFileSync(
    path,
    [
      "---",
      "title: Fixture FR",
      `milestone: ${milestone}`,
      `status: ${status}`,
      `archived_at: ${status === "archived" ? "2026-09-10T00:00:00Z" : "null"}`,
      "tracker:",
      `  ${tracker}: ${key}`,
      "---",
      "",
      "# Fixture FR",
      "",
    ].join("\n"),
  );
  return path;
}

// ------------------------------------------------------------------ listings

/** A measured `getVisibleJiraProjects` answer listing `keys` (tests/fixtures/live-shapes/jira/getVisibleJiraProjects.json). */
export function jiraProjects(keys: string[]): unknown {
  return {
    self: "https://fixture.invalid/rest/api/3/project/search?maxResults=50&startAt=0",
    maxResults: 50,
    startAt: 0,
    total: keys.length,
    isLast: true,
    values: keys.map((key, i) => ({ id: String(10001 + i), key, name: `Project ${key}` })),
  };
}

export function jiraEpics(project: string, keys: string[]): unknown {
  return {
    issues: keys.map((key) => ({
      key,
      fields: {
        summary: `Epic ${key}`,
        project: { key: project },
        issuetype: { name: "Epic" },
        status: { name: "To Do", statusCategory: { key: "new" } },
        labels: [],
      },
    })),
    isLast: true,
  };
}

/** A measured `getJiraProjectIssueTypesMetadata` answer offering `names`, complete (startAt 0, `total` rows). */
export function jiraIssueTypes(names: string[]): unknown {
  return { startAt: 0, maxResults: 50, total: names.length, issueTypes: names.map((name, i) => ({ id: String(11100 + i), name })) };
}

/** A hand-assembled Jira status list claiming `isLast: true` — no Atlassian MCP tool lists a project's statuses. */
export function statusListing(names: string[]): unknown {
  return { statuses: names.map((name, i) => ({ id: String(i + 1), name })), isLast: true };
}

/** A measured Linear `list_issue_statuses` answer: a bare array (tests/fixtures/live-shapes/linear/list_issue_statuses.json). */
export function linearStatuses(names: string[]): unknown {
  return names.map((name, i) => ({ id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, type: "unstarted", name }));
}

export function jiraLabels(labels: string[]): unknown {
  return { values: labels, isLast: true };
}

/** The measured GF label set: numeric M23..M46, three Epic-keyed tokens, and the peer's tag. */
export function measuredGfLabels(): string[] {
  const out: string[] = [];
  for (let n = 23; n <= 46; n++) out.push(`milestone-M${n}`);
  out.push("milestone-M_GF_80", "milestone-M_GF_83", "milestone-M_GF_85", "glacy-fe");
  return out;
}

// ------------------------------------------------------------------ the Glacy fixture

export interface Glacy {
  /** glacy-app-be — the repository being repointed GB → GF. */
  a: string;
  /** glacy-app-fe — the peer, already bound to GF. */
  b: string;
  /** Directory holding the listing files. */
  lst: string;
  /** Write a listing file (object → JSON; string → verbatim) and return its path. */
  listing(name: string, content: unknown): string;
  /** The default argv (after the front door path), with named flags overridden or dropped (value null). */
  args(overrides?: Partial<Record<"--projects" | "--containers" | "--issue-types" | "--statuses" | "--labels", string | null>>, peers?: string[]): string[];
  extraDirs: string[];
  cleanup(): void;
}

export interface GlacyOpts {
  /** Write M_GB_40 active with two active FRs GB-101 / GB-102 (the measured stranded plan). */
  activeGb40?: boolean;
  /** Override A's CLAUDE.md options. */
  a?: Partial<JiraMdOpts>;
  /** Override B's CLAUDE.md options. */
  b?: Partial<JiraMdOpts>;
  /** Peer's .mcp.json URL (default: the same server). */
  peerUrl?: string;
}

export function makeGlacy(opts: GlacyOpts = {}): Glacy {
  const span = makeSpanFixture("M_GB_40");
  const lst = mkdtempSync(join(tmpdir(), "dpt-ste612-lst-"));
  const extraDirs: string[] = [];
  const { a, b } = span;

  writeFileSync(
    join(a, "CLAUDE.md"),
    jiraClaudeMdText({ project: "GB", repoTag: "glacy-be", issueType: "Task", mcpServer: "atlassian", ...opts.a }),
  );
  writeMcpJson(a, { atlassian: ATLASSIAN_URL });
  writeTrackerConfig(a, "jira", GB_CONFIG_STATUSES);
  for (let n = 1; n <= 39; n++) writePlan(a, `M${n}`, "archived");
  for (const key of ["GB-1", "GB-2", "GB-3"]) writeFr(a, key, "M1", "archived");
  if (opts.activeGb40) {
    writePlan(a, "M_GB_40", "active", "Checkout");
    writeFr(a, "GB-101", "M_GB_40", "active");
    writeFr(a, "GB-102", "M_GB_40", "active");
  }
  commitAll(a, "fixture: glacy-app-be bound to GB");

  writeFileSync(
    join(b, "CLAUDE.md"),
    jiraClaudeMdText({ project: "GF", repoTag: "glacy-fe", issueType: "Task", mcpServer: "claude.ai Atlassian", ...opts.b }),
  );
  writeMcpJson(b, { "claude.ai Atlassian": opts.peerUrl ?? ATLASSIAN_URL });
  commitAll(b, "fixture: glacy-app-fe bound to GF");

  const listing = (name: string, content: unknown): string => {
    const p = join(lst, name);
    writeFileSync(p, typeof content === "string" ? content : JSON.stringify(content));
    return p;
  };
  const defaults: Record<string, string> = {
    "--projects": listing("projects.json", jiraProjects(["GB", "GF", "GX"])),
    "--containers": listing("containers.json", jiraEpics("GF", ["GF-80", "GF-83", "GF-85"])),
    "--issue-types": listing("issue-types.json", jiraIssueTypes(["Epic", "Task", "Bug"])),
    "--statuses": listing("statuses.json", statusListing(GF_STATUSES)),
    "--labels": listing("labels.json", jiraLabels(measuredGfLabels())),
  };

  return {
    a,
    b,
    lst,
    listing,
    extraDirs,
    args(overrides = {}, peers = [b]) {
      const out = [a, "jira", "GF"];
      for (const flag of Object.keys(defaults)) {
        const v = flag in overrides ? (overrides as Record<string, string | null>)[flag] : defaults[flag];
        if (v === null || v === undefined) continue;
        out.push(flag, v);
      }
      for (const p of peers) out.push("--peer", p);
      return out;
    },
    cleanup() {
      try {
        span.cleanup();
      } finally {
        rmSync(lst, { recursive: true, force: true });
        for (const d of extraDirs) rmSync(d, { recursive: true, force: true });
      }
    },
  };
}

// ------------------------------------------------------------------ running

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export function runRepoint(args: string[], sessionId: string = SESSION_ID): RunResult {
  const proc = spawnSync("bun", ["run", FRONT_DOOR, ...args], {
    cwd: PLUGIN_ROOT,
    env: { ...GIT_ENV, CLAUDE_CODE_SESSION_ID: sessionId },
    encoding: "utf-8",
    timeout: 60_000,
  });
  return { code: proc.status, stdout: proc.stdout ?? "", stderr: proc.stderr ?? "" };
}

const ROW_RE = (n: number) => new RegExp(`^${n} (PASS|REFUSE|NOT-APPLICABLE)(?:\\s|$)`);

/** The `<n> VERDICT reason` line for row n, or "" when the command printed none. */
export function rowLine(stdout: string, n: number): string {
  return stdout.split("\n").find((l) => ROW_RE(n).test(l)) ?? "";
}

/** Row n's verdict, or null when no row line was printed. */
export function verdict(stdout: string, n: number): "PASS" | "REFUSE" | "NOT-APPLICABLE" | null {
  const m = ROW_RE(n).exec(rowLine(stdout, n));
  return (m?.[1] as "PASS" | "REFUSE" | "NOT-APPLICABLE" | undefined) ?? null;
}

/** Every row line the command printed (rows 1..7 shape). */
export function rowLines(stdout: string): string[] {
  return stdout.split("\n").filter((l) => /^\d+ (PASS|REFUSE|NOT-APPLICABLE)(?:\s|$)/.test(l));
}

/** The receipt files the session wrote under `root`. */
export function receiptFiles(root: string, sessionId: string = SESSION_ID): string[] {
  const dir = receiptsDir(root, sessionId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith(".json"))
    .map((n) => join(dir, n));
}

export function readClaudeMd(root: string): string {
  return readFileSync(join(root, "CLAUDE.md"), "utf-8");
}

/**
 * An FR file directly under `specs/frs/` with free-form `status:` and tracker
 * entries — the shapes `writeFr` cannot express: an FR marked archived but not
 * yet moved, or one carrying keys for more than one tracker.
 */
export function writeFrRaw(
  root: string,
  name: string,
  milestone: string,
  status: string,
  tracker: Record<string, string>,
): string {
  const dir = join(root, "specs", "frs");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${name}.md`);
  writeFileSync(
    path,
    [
      "---",
      "title: Fixture FR",
      `milestone: ${milestone}`,
      `status: ${status}`,
      `archived_at: ${status === "archived" ? "2026-09-10T00:00:00Z" : "null"}`,
      "tracker:",
      ...Object.entries(tracker).map(([k, v]) => `  ${k}: ${v}`),
      "---",
      "",
      "# Fixture FR",
      "",
    ].join("\n"),
  );
  return path;
}
