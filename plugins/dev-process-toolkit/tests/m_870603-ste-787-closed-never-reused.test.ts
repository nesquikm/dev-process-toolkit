// STE-787 (M_870603) — a create never reuses a closed ticket, and the minted
// milestone Epic carries the project's default labels.
//
// Before a create, `create_idempotency_probe.ts decide` looks for a ticket a
// timed-out create already made. It matched an old, DONE ticket with the same
// title and offered it for reuse. A done ticket is finished work, not a lost
// create. And `mintMilestoneEpic` wrote only `milestone-<id>` on the Epic, so
// cleanup that searches by the default label left the Epic open.
//
// Shapes used here:
//   jira   — `searchJiraIssuesUsingJql` row: { key, fields: { summary, labels,
//            issuetype: { name }, parent: { key }, project: { key },
//            status: { name, statusCategory: { key } } } }
//   linear — `list_issues` row: { id, title, labels, projectMilestone: { id },
//            project, team, statusType }
//
// Every decide assertion goes through the real command (a subprocess), so the
// test grades the printed decision, not an internal field name.

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mintMilestoneEpic } from "../adapters/_shared/src/mint_milestone_epic";
import { claudeMd, pluginManifest } from "./_span_fixture";

// A spawned child under gate load can outlive bun's 5 s default; a real hang
// still fails, 60 s later.
setDefaultTimeout(60_000);

const PLUGIN_ROOT = join(import.meta.dir, "..");
const MODULE = join(PLUGIN_ROOT, "adapters", "_shared", "src", "create_idempotency_probe.ts");
const SESSION = `ste787-${process.pid}`;

const TITLE = "The reward banner - repainted light";
const EPIC = "GK-40";
const LINEAR_MS_ID = "ms-3fa85f64";

const tempDirs: string[] = [];
let manifestDir = "";

beforeAll(() => {
  manifestDir = tempDir("manifest");
  pluginManifest(manifestDir, "2.87.0");
});

afterAll(() => {
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempDir(label: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `dpt-787-${label}-`)));
  tempDirs.push(d);
  return d;
}

function jiraRoot(): string {
  const root = tempDir("jira");
  claudeMd(root, { mode: "jira", project: "GK" });
  return root;
}

function linearRoot(): string {
  const root = tempDir("linear");
  claudeMd(root, { mode: "linear", team: "STE", project: "DPT" });
  return root;
}

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function runModule(args: string[]): Run {
  const proc = Bun.spawnSync(["bun", "run", MODULE, ...args], {
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: manifestDir, CLAUDE_CODE_SESSION_ID: SESSION },
    stdout: "pipe",
    stderr: "pipe",
  });
  const signal = proc.signalCode ?? null;
  const stderr = proc.stderr.toString();
  return {
    code: proc.exitCode ?? -1,
    stdout: proc.stdout.toString(),
    stderr: signal === null ? stderr : `${stderr}\n[child killed by ${signal}: harness failure, not a verdict]`,
  };
}

/** The ONE JSON line a subcommand prints. */
function jsonLine(run: Run): Record<string, any> {
  const lines = run.stdout.split("\n").filter((l) => l.trim().startsWith("{"));
  expect(
    lines.length,
    `expected exactly one JSON line on stdout; code=${run.code}\nstdout=${run.stdout}\nstderr=${run.stderr}`,
  ).toBe(1);
  return JSON.parse(lines[0]!);
}

function writePage(page: unknown): string {
  const p = join(tempDir("page"), "page.json");
  writeFileSync(p, JSON.stringify(page));
  return p;
}

function decideJira(root: string, page: unknown): Record<string, any> {
  return jsonLine(
    runModule(["decide", root, writePage(page), "--title", TITLE, "--parent", EPIC, "--attempt", "fast"]),
  );
}

function decideLinear(root: string, page: unknown): Record<string, any> {
  return jsonLine(
    runModule(["decide", root, writePage(page), "--title", TITLE, "--linear-milestone", LINEAR_MS_ID, "--attempt", "fast"]),
  );
}

type JiraCategory = "new" | "indeterminate" | "done" | null;

/** A Jira row; `category: null` omits the `status` field entirely. */
function jiraRow(key: string, category: JiraCategory, summary = TITLE): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    summary,
    labels: [],
    issuetype: { name: "Task" },
    parent: { key: EPIC },
    project: { key: "GK" },
  };
  if (category !== null) {
    fields.status = {
      name: category === "done" ? "Done" : category === "new" ? "To Do" : "In Progress",
      statusCategory: { key: category },
    };
  }
  return { key, fields };
}

const jiraPage = (issues: unknown[]) => ({ issues, isLast: true });

type LinearStatus = "backlog" | "unstarted" | "started" | "completed" | "canceled" | null;

/** A Linear row; `statusType: null` omits the field entirely. */
function linearRow(id: string, statusType: LinearStatus, title = TITLE): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id,
    title,
    labels: [],
    projectMilestone: { id: LINEAR_MS_ID, name: "M" },
    project: "DPT",
    team: "Example Team Display Name",
  };
  if (statusType !== null) row.statusType = statusType;
  return row;
}

const linearPage = (issues: unknown[]) => ({ issues, hasNextPage: false });

// ===========================================================================
// AC-STE-787.1 — query asks for status; a closed candidate is no match.
// ===========================================================================

describe("AC-STE-787.1 — query asks for the status, and decide ignores closed candidates", () => {
  test("AC-STE-787.1: the Jira query's fields include `status`", () => {
    const run = runModule(["query", jiraRoot(), "--title", TITLE, "--parent", EPIC]);
    const printed = jsonLine(run);
    expect(printed.fields).toContain("status");
  });

  test("AC-STE-787.1: the Linear query's fields include `statusType`", () => {
    const run = runModule(["query", linearRoot(), "--title", TITLE, "--linear-milestone", LINEAR_MS_ID]);
    const printed = jsonLine(run);
    expect(printed.fields).toContain("statusType");
  });

  test("AC-STE-787.1: a Jira page holding only a done same-title ticket yields create", () => {
    const d = decideJira(jiraRoot(), jiraPage([jiraRow("GK-801", "done")]));
    expect(d.outcome).toBe("create");
    expect(d.key).toBeUndefined();
  });

  test("AC-STE-787.1: a Linear page holding only a completed same-title ticket yields create", () => {
    const d = decideLinear(linearRoot(), linearPage([linearRow("STE-901", "completed")]));
    expect(d.outcome).toBe("create");
    expect(d.key).toBeUndefined();
  });

  test("AC-STE-787.1: a Linear page holding only a canceled same-title ticket yields create", () => {
    const d = decideLinear(linearRoot(), linearPage([linearRow("STE-902", "canceled")]));
    expect(d.outcome).toBe("create");
    expect(d.key).toBeUndefined();
  });
});

// ===========================================================================
// AC-STE-787.2 — a status-less candidate reads as open, exactly as before.
// Amended 2026-11-14 (operator delegate): refusing status-less rows would
// break every page recorded before the query asked for status.
// ===========================================================================

describe("AC-STE-787.2 — a candidate without the status field reads as open", () => {
  test("AC-STE-787.2: a Jira same-title row with no `status` is reused, as before", () => {
    const d = decideJira(jiraRoot(), jiraPage([jiraRow("GK-811", null)]));
    expect(d.outcome).toBe("reused");
    expect(d.key).toBe("GK-811");
  });

  test("AC-STE-787.2: a Jira row whose `status` has no statusCategory key is reused, as before", () => {
    const row = jiraRow("GK-812", "indeterminate");
    (row.fields as Record<string, unknown>).status = { name: "In Progress" };
    const d = decideJira(jiraRoot(), jiraPage([row]));
    expect(d.outcome).toBe("reused");
    expect(d.key).toBe("GK-812");
  });

  test("AC-STE-787.2: a Linear same-title row with no `statusType` is reused, as before", () => {
    const d = decideLinear(linearRoot(), linearPage([linearRow("STE-911", null)]));
    expect(d.outcome).toBe("reused");
    expect(d.key).toBe("STE-911");
  });
});

// ===========================================================================
// AC-STE-787.3 — an open same-title candidate is still reused.
// ===========================================================================

describe("AC-STE-787.3 — an open same-title candidate is reused as before", () => {
  test("AC-STE-787.3: a Jira in-progress same-title ticket is reused", () => {
    const d = decideJira(jiraRoot(), jiraPage([jiraRow("GK-821", "indeterminate")]));
    expect(d.outcome).toBe("reused");
    expect(d.key).toBe("GK-821");
  });

  test("AC-STE-787.3: a Jira to-do same-title ticket is reused", () => {
    const d = decideJira(jiraRoot(), jiraPage([jiraRow("GK-822", "new")]));
    expect(d.outcome).toBe("reused");
    expect(d.key).toBe("GK-822");
  });

  test("AC-STE-787.3: beside a done twin, the open Jira ticket is the one reused", () => {
    const d = decideJira(jiraRoot(), jiraPage([jiraRow("GK-823", "done"), jiraRow("GK-824", "indeterminate")]));
    expect(d.outcome).toBe("reused");
    expect(d.key).toBe("GK-824");
  });

  test("AC-STE-787.3: a Linear started same-title ticket is reused", () => {
    const d = decideLinear(linearRoot(), linearPage([linearRow("STE-921", "started")]));
    expect(d.outcome).toBe("reused");
    expect(d.key).toBe("STE-921");
  });

  test("AC-STE-787.3: beside a completed twin, the open Linear ticket is the one reused", () => {
    const d = decideLinear(linearRoot(), linearPage([linearRow("STE-922", "completed"), linearRow("STE-923", "backlog")]));
    expect(d.outcome).toBe("reused");
    expect(d.key).toBe("STE-923");
  });
});

// ===========================================================================
// AC-STE-787.4 — the minted Epic carries every default label.
// ===========================================================================

describe("AC-STE-787.4 — mintMilestoneEpic writes the default labels beside milestone-<id>", () => {
  const PROJECT = "GK";
  const EPIC_TITLE = "Waiting States II";
  const EPIC_KEY = "GK-78";

  function recordingProvider(failOn: ReadonlySet<string> = new Set()) {
    const labels: Array<{ ticket: string; label: string }> = [];
    let creates = 0;
    return {
      labels,
      creates: () => creates,
      provider: {
        createEpic: async (_project: string, _opts: { name: string }) => {
          creates += 1;
          return { key: EPIC_KEY };
        },
        addLabel: async (ticket: string, label: string) => {
          if (failOn.has(label)) throw new Error(`label write rejected: ${label}`);
          labels.push({ ticket, label });
        },
      },
    };
  }

  test("AC-STE-787.4: every default label and the milestone label land on the minted Epic", async () => {
    const rec = recordingProvider();
    const minted = await mintMilestoneEpic(rec.provider, PROJECT, EPIC_TITLE, {
      defaultLabels: ["glade-be", "team-x"],
    } as any);
    expect(minted.epicKey).toBe(EPIC_KEY);
    expect(rec.labels.map((l) => l.ticket)).toEqual([EPIC_KEY, EPIC_KEY, EPIC_KEY]);
    expect(new Set(rec.labels.map((l) => l.label))).toEqual(
      new Set(["milestone-M_GK_78", "glade-be", "team-x"]),
    );
    expect(minted.labelled).toBe(true);
  });

  test("AC-STE-787.4: a failed default-label write does not fail the mint, and labelled reports it", async () => {
    const rec = recordingProvider(new Set(["glade-be"]));
    const minted = await mintMilestoneEpic(rec.provider, PROJECT, EPIC_TITLE, {
      defaultLabels: ["glade-be"],
      sleep: async () => {},
    } as any);
    expect(minted.epicKey).toBe(EPIC_KEY);
    expect(minted.milestoneId).toBe("M_GK_78");
    expect(rec.creates()).toBe(1);
    expect(minted.labelled).toBe(false);
  });

  test("AC-STE-787.4: a failed default-label write still leaves the milestone label written", async () => {
    const rec = recordingProvider(new Set(["glade-be"]));
    await mintMilestoneEpic(rec.provider, PROJECT, EPIC_TITLE, {
      defaultLabels: ["glade-be"],
      sleep: async () => {},
    } as any);
    expect(rec.labels.map((l) => l.label)).toContain("milestone-M_GK_78");
  });

  test("AC-STE-787.4: without defaultLabels the mint writes only milestone-<id> (backward compatible)", async () => {
    const rec = recordingProvider();
    const minted = await mintMilestoneEpic(rec.provider, PROJECT, EPIC_TITLE);
    expect(rec.labels).toEqual([{ ticket: EPIC_KEY, label: "milestone-M_GK_78" }]);
    expect(minted.labelled).toBe(true);
  });
});
