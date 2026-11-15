// STE-786 (M_870603) — the drift probe sees an FR whose Jira ticket is done.
//
// Probe #49's Jira listing used `statusCategory != Done`, so a ticket an
// active local FR binds dropped off the page the moment it closed, and the FR
// read as a dangling `local-orphan`. The fix is a listing-query front door
// that adds every bound key back into the JQL; the reconcile already treats a
// closed bound ticket on the page as a match.
//
// Filter by AC with `bun test -t "AC-STE-786.N"`. AC-STE-786.5 is the
// orchestrator's full-suite gate and has no test here.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Provider } from "../adapters/_shared/src/provider";
import { runTrackerLocalReconciliationDriftProbe } from "../adapters/_shared/src/tracker_local_reconciliation_drift";
import {
  archivedBoundFr,
  boundFr,
  declareJira,
  declareLinear,
  jiraIssue,
  jiraRow,
  linearRow,
  PLUGIN_ROOT,
  spawnModule,
  type Ticket,
} from "./_orphan_pages";
import { pluginManifest } from "./_span_fixture";

const QUERY_MODULE = join(PLUGIN_ROOT, "adapters", "_shared", "src", "tracker_listing_query.ts");
const OLD_JQL = "project = GK AND statusCategory != Done";

let manifest = "";
const roots: string[] = [];

beforeAll(() => {
  manifest = mkdtempSync(join(tmpdir(), "dpt-ste786-manifest-"));
  pluginManifest(manifest, "3.5.0");
});

afterAll(() => {
  rmSync(manifest, { recursive: true, force: true });
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

function freshRoot(): string {
  const r = mkdtempSync(join(tmpdir(), "dpt-ste786-root-"));
  roots.push(r);
  mkdirSync(join(r, "specs", "frs"), { recursive: true });
  return r;
}

function runQuery(args: string[]) {
  return spawnModule(QUERY_MODULE, args, { CLAUDE_PLUGIN_ROOT: manifest });
}

/** A local active FR whose `tracker.jira` binding is a raw (possibly malformed) value. */
function rawBoundFr(root: string, file: string, value: string): void {
  writeFileSync(
    join(root, "specs", "frs", `${file}.md`),
    [
      "---",
      `title: ${file}`,
      "milestone: M_GK_85",
      "status: active",
      "archived_at: null",
      "tracker:",
      `  jira: "${value}"`,
      "created_at: 2026-11-14T00:00:00Z",
      "---",
      "",
      `# ${file}`,
      "",
    ].join("\n"),
  );
}

const PREFIX = "project = GK AND (statusCategory != Done OR key in (";
const SUFFIX = "))";

/** The keys inside `key in (...)`, in printed order; null when the JQL is not the widened shape. */
function keysInWidenedJql(jql: string): string[] | null {
  if (!jql.startsWith(PREFIX) || !jql.endsWith(SUFFIX)) return null;
  return jql
    .slice(PREFIX.length, jql.length - SUFFIX.length)
    .split(/,\s*/)
    .map((k) => k.trim());
}

// ---------------------------------------------------------------- AC-.1

describe("AC-STE-786.1 — the listing-query front door", () => {
  test("AC-STE-786.1 — the module exists at adapters/_shared/src/tracker_listing_query.ts", () => {
    expect(existsSync(QUERY_MODULE)).toBe(true);
  });

  test("AC-STE-786.1 — with no bound keys it prints the old JQL unchanged", () => {
    const root = freshRoot();
    declareJira(root, null);
    const run = runQuery(["jira", root, "GK"]);
    expect(run.code, run.stderr).toBe(0);
    expect(run.stdout.trim()).toBe(OLD_JQL);
  });

  test("AC-STE-786.1 — bound Jira keys of active FRs are added, sorted", () => {
    const root = freshRoot();
    declareJira(root, null);
    // Written out of order on purpose; string and numeric order agree here.
    boundFr(root, "GK-305");
    boundFr(root, "GK-301");
    boundFr(root, "GK-302");
    const run = runQuery(["jira", root, "GK"]);
    expect(run.code, run.stderr).toBe(0);
    const jql = run.stdout.trim();
    expect(keysInWidenedJql(jql), `printed: ${jql}`).toEqual(["GK-301", "GK-302", "GK-305"]);
  });

  test("AC-STE-786.1 — keys bound only by archived FRs are not active and are left out", () => {
    const root = freshRoot();
    declareJira(root, null);
    boundFr(root, "GK-301");
    archivedBoundFr(root, "GK-777");
    const run = runQuery(["jira", root, "GK"]);
    expect(run.code, run.stderr).toBe(0);
    expect(keysInWidenedJql(run.stdout.trim()), `printed: ${run.stdout}`).toEqual(["GK-301"]);
  });

  test("AC-STE-786.1 — a Linear binding is not a Jira key and is left out", () => {
    const root = freshRoot();
    declareJira(root, null);
    boundFr(root, "STE-12", "linear");
    const run = runQuery(["jira", root, "GK"]);
    expect(run.code, run.stderr).toBe(0);
    expect(run.stdout.trim()).toBe(OLD_JQL);
  });

  test("AC-STE-786.1 — the project key argument names the project in the JQL", () => {
    const root = freshRoot();
    declareJira(root, null);
    const run = runQuery(["jira", root, "DST"]);
    expect(run.code, run.stderr).toBe(0);
    expect(run.stdout.trim()).toBe("project = DST AND statusCategory != Done");
  });

  test("AC-STE-786.1 — a malformed bound key is refused, never interpolated", () => {
    const root = freshRoot();
    declareJira(root, null);
    boundFr(root, "GK-301");
    rawBoundFr(root, "evil", "GK-1) OR project = SECRET OR key in (X-1");
    const run = runQuery(["jira", root, "GK"]);
    expect(run.code).not.toBe(0);
    expect(run.stdout).not.toContain("SECRET");
    expect(run.stdout).not.toContain("statusCategory");
  });

  test("AC-STE-786.1 — the pure builder refuses a malformed key", async () => {
    const mod = (await import(QUERY_MODULE)) as Record<string, unknown>;
    const builders = Object.values(mod).filter((v): v is (...a: unknown[]) => unknown => typeof v === "function");
    expect(builders.length, "tracker_listing_query.ts exports no builder function").toBeGreaterThan(0);
    // Every exported builder that accepts (projectKey, keys) must refuse a
    // key outside ^[A-Z][A-Z0-9_]*-\d+$; at least one must build the good case.
    let built = 0;
    for (const fn of builders) {
      let good: unknown;
      try {
        good = fn("GK", ["GK-2", "GK-1"]);
      } catch {
        continue; // not the (projectKey, keys) builder
      }
      if (typeof good !== "string") continue;
      built += 1;
      expect(keysInWidenedJql(good)).toEqual(["GK-1", "GK-2"]);
      expect(() => fn("GK", ["GK-1", "gk-2) OR 1=1"])).toThrow();
      expect(() => fn("GK", ["GK-1 OR project = X"])).toThrow();
    }
    expect(built, "no exported builder of the shape (projectKey, keys) => string").toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- AC-.2

describe("AC-STE-786.2 — the docs run the front door", () => {
  test("AC-STE-786.2 — adapters/jira.md `list_active_frs` runs tracker_listing_query.ts jira", () => {
    const md = readFileSync(join(PLUGIN_ROOT, "adapters", "jira.md"), "utf8");
    const row = md.split("\n").find((l) => l.startsWith("| `list_active_frs` |"));
    expect(row, "no list_active_frs row in adapters/jira.md").toBeDefined();
    expect(row!).toContain("tracker_listing_query.ts jira");
  });

  test("AC-STE-786.2 — gate-check probe #49 runs tracker_listing_query.ts jira and uses its JQL", () => {
    const md = readFileSync(join(PLUGIN_ROOT, "skills", "gate-check", "SKILL.md"), "utf8");
    const line = md.split("\n").find((l) => l.startsWith("49. **`tracker_local_reconciliation_drift`**"));
    expect(line, "no probe #49 line in skills/gate-check/SKILL.md").toBeDefined();
    expect(line!).toContain("tracker_listing_query.ts jira");
  });
});

// ---------------------------------------------------------------- AC-.3 / AC-.4

const provider = {
  mode: "tracker",
  listActiveFRs: async () => [],
  listMilestones: async () => [],
} as unknown as Provider;

const t = (key: string, title: string): Ticket => ({ key, title, labels: [], creator: "Fe Dev", backLink: true });

describe("AC-STE-786.3 — a done bound Jira ticket on the page is not an orphan", () => {
  async function run() {
    const root = freshRoot();
    declareJira(root, null);
    boundFr(root, "GK-301"); // done, on the page
    boundFr(root, "GK-302"); // open, on the page
    boundFr(root, "GK-999"); // on no page
    const page = {
      issues: [
        jiraRow(t("GK-301", "Shipped, FR still active"), { statusCategory: "done" }),
        jiraRow(t("GK-302", "In flight"), { statusCategory: "indeterminate" }),
        jiraIssue(t("GK-400", "Unbound open")),
      ],
      isLast: true,
    };
    return runTrackerLocalReconciliationDriftProbe(root, { provider, containerPages: [page], skipMilestoneDrift: true });
  }

  test("AC-STE-786.3 — the FR bound to the done ticket is not a local-orphan", async () => {
    const res = await run();
    const notes = res.violations.filter((v) => v.kind === "local-orphan").map((v) => v.note);
    expect(notes.some((n) => n.includes("GK-301"))).toBe(false);
  });

  test("AC-STE-786.3 — no tracker-orphan row names the done bound ticket", async () => {
    const res = await run();
    const notes = res.violations.filter((v) => v.kind === "tracker-orphan").map((v) => v.note);
    expect(notes.some((n) => n.includes("GK-301"))).toBe(false);
    // CONTROL: the unbound open ticket on the same page is still a tracker orphan.
    expect(notes.some((n) => n.includes("GK-400"))).toBe(true);
  });

  test("AC-STE-786.3 — an FR whose bound key is absent from the page is still a local-orphan error", async () => {
    const res = await run();
    const orphans = res.violations.filter((v) => v.kind === "local-orphan");
    expect(orphans.map((v) => v.note.includes("GK-999"))).toEqual([true]);
    expect(orphans[0]!.severity).toBe("error");
    expect(res.severity).toBe("error");
  });
});

describe("AC-STE-786.4 — Linear: a closed bound issue on the page is not an orphan", () => {
  async function run() {
    const root = freshRoot();
    declareLinear(root, null);
    boundFr(root, "STE-301", "linear"); // completed, on the page
    boundFr(root, "STE-999", "linear"); // on no page
    const page = {
      issues: [
        linearRow(t("STE-301", "Shipped, FR still active"), { statusType: "completed", completedAt: "2026-11-14T00:00:00Z" }),
        linearRow(t("STE-400", "Unbound open"), { statusType: "started", completedAt: null, canceledAt: null }),
      ],
      hasNextPage: false,
    };
    return runTrackerLocalReconciliationDriftProbe(root, { provider, containerPages: [page], skipMilestoneDrift: true });
  }

  test("AC-STE-786.4 — the FR bound to the completed Linear issue is not a local-orphan; the absent one is", async () => {
    const res = await run();
    const orphans = res.violations.filter((v) => v.kind === "local-orphan").map((v) => v.note);
    expect(orphans.some((n) => n.includes("STE-301"))).toBe(false);
    expect(orphans.map((n) => n.includes("STE-999"))).toEqual([true]);
  });

  test("AC-STE-786.4 — no tracker-orphan row names the completed bound issue", async () => {
    const res = await run();
    const notes = res.violations.filter((v) => v.kind === "tracker-orphan").map((v) => v.note);
    expect(notes.some((n) => n.includes("STE-301"))).toBe(false);
    expect(notes.some((n) => n.includes("STE-400"))).toBe(true);
  });
});

// Pass 2 review (M_870603): an unreadable FR file is refused in the NFR-10 shape,
// never a raw stack trace.
describe("AC-STE-786.1 — an unreadable FR file is refused, not thrown", () => {
  test("AC-STE-786.1 — a frontmatter-bearing FR file that cannot be read exits 1 with Refusing/Remedy/Context", () => {
    if (process.getuid?.() === 0) return; // root reads a mode-000 file; the case cannot be staged
    const root = freshRoot();
    const file = join(root, "specs", "frs", "GK-1.md");
    writeFileSync(file, "---\ntracker:\n  jira: GK-1\n---\n# x\n");
    const { chmodSync } = require("node:fs") as typeof import("node:fs");
    chmodSync(file, 0o000);
    try {
      const r = runQuery(["jira", root, "GK"]);
      expect(r.code).toBe(1);
      expect(r.stdout.trim()).toBe("");
      expect(r.stderr).toMatch(/^Refusing: /m);
      expect(r.stderr).toMatch(/^Remedy: /m);
      expect(r.stderr).toMatch(/^Context: projectRoot=/m);
      expect(r.stderr).not.toMatch(/\n\s+at /);
    } finally {
      chmodSync(file, 0o644);
    }
  });
});
