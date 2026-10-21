// M_0cac80 / STE-682 — "Import refuses a ticket it cannot read for bug detection".
//
// WHAT THE IMPLEMENTER WRITES.
//
//   adapters/_shared/src/import.ts — bug detection answers one of three:
//   bug, not a bug, UNREADABLE. With an ownership context on Jira or Linear,
//   `importFromTracker` throws on unreadable before any FR file write or
//   tracker sync, when
//     * no readable answer holds the ticket (the fetched ticket, or its item
//       on the listing `pages`), or
//     * that answer lacks the field bug detection reads:
//         Linear — a `labels` list;
//         Jira   — `fields.issuetype.name` as a string.
//   The refusal is in the NFR-10 shape (requirements.md § NFR-10):
//
//     <one-line verdict naming the ticket>
//     Remedy: <actionable next step>
//     Context: mode=<mode>, ticket=<id>, …
//
//   and names the ticket and the missing field.
//
// Out of scope (pinned as a control): an import with NO ownership context is
// unchanged. A readable plain ticket and a readable bug ticket import exactly
// as today (literal bodies below, clock pinned).
//
// Filter by AC with `bun test -t "AC-STE-682.N"`.

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { importFromTracker, ticketImportOwnership } from "../adapters/_shared/src/import";
import type { ImportOwnershipContext } from "../adapters/_shared/src/import";
import type { FRMetadata, FRSpec, LockResult, Provider, SyncResult } from "../adapters/_shared/src/provider";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type Mode = "jira" | "linear";

const roots: string[] = [];
function tempRoot(slug: string): string {
  const r = mkdtempSync(join(tmpdir(), `ste682-${slug}-`));
  roots.push(r);
  return r;
}
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

/** A non-shared (no repo_tag) CLAUDE.md for one tracker mode. */
function writeClaudeMd(root: string, mode: Mode): void {
  const lines = [
    "# Fixture Project",
    "",
    "## Task Tracking",
    "",
    `mode: ${mode}`,
    `mcp_server: ${mode === "jira" ? "atlassian" : "linear"}`,
    "",
    mode === "jira" ? "### Jira" : "### Linear",
    "",
  ];
  if (mode === "linear") lines.push("team: STE");
  lines.push(mode === "jira" ? "project: GF" : "project: DPT");
  lines.push("", "## Verification", "", "run_cmd: none", "");
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "CLAUDE.md"), lines.join("\n"));
}

/** One Jira `getJiraIssue` result; `fieldsPatch` overrides/removes fields (undefined deletes). */
function jiraTicket(key: string, type: string, fieldsPatch: Record<string, unknown> = {}): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    summary: `Ticket ${key}`,
    labels: [],
    issuetype: { name: type, hierarchyLevel: 0 },
    status: { name: "To Do" },
    project: { key: "GF" },
    creator: { displayName: "Someone" },
    description: "Filed from the board.",
  };
  for (const [k, v] of Object.entries(fieldsPatch)) {
    if (v === undefined) delete fields[k];
    else fields[k] = v;
  }
  return { key, fields };
}

/** One Linear `get_issue` answer; `patch` overrides/removes top-level fields (undefined deletes). */
function linearTicket(key: string, labels: unknown, patch: Record<string, unknown> = {}): Record<string, unknown> {
  const t: Record<string, unknown> = {
    id: key,
    title: `Issue ${key}`,
    labels,
    description: "Filed from the board.",
    createdBy: "Someone",
    project: "DPT",
    team: "Example Team Display Name",
    status: "Backlog",
  };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete t[k];
    else t[k] = v;
  }
  return t;
}

const jiraPage = (...issues: Record<string, unknown>[]) => ({ issues, isLast: true });
const linearPage = (...issues: Record<string, unknown>[]) => ({ issues, hasNextPage: false });

class StubProvider implements Provider {
  readonly mode = "tracker" as const;
  syncCalls: FRSpec[] = [];
  async listMilestones(): Promise<{ name: string }[]> {
    return [];
  }
  async listActiveFRs(): Promise<string[]> {
    return [];
  }
  async getMetadata(id: string): Promise<FRMetadata> {
    const key = id.split(":").slice(1).join(":");
    const m = {
      id,
      title: `Ticket ${key}`,
      milestone: "",
      status: "active",
      tracker: {},
      inFlightBranch: null,
      assignee: null,
    } as FRMetadata;
    (m as unknown as Record<string, unknown>)["description"] = "Filed from the board.";
    (m as unknown as Record<string, unknown>)["acs"] = ["Thing works."];
    return m;
  }
  async sync(spec: FRSpec): Promise<SyncResult> {
    this.syncCalls.push(spec);
    return { kind: "ok", updated: [], conflicts: [], message: "ok" };
  }
  getUrl(): string | null {
    return null;
  }
  async claimLock(): Promise<LockResult> {
    return { kind: "claimed", branch: null, message: "" };
  }
  async releaseLock(): Promise<"transitioned" | "already-released"> {
    return "already-released";
  }
  async getTicketStatus(): Promise<{ status: string }> {
    return { status: "local-no-tracker" };
  }
  filenameFor(spec: FRSpec): string {
    const tracker = spec.frontmatter["tracker"] as Record<string, string>;
    return `${Object.values(tracker)[0]}.md`;
  }
}

type Ctx = { kind: "ticket"; ticket: unknown } | { kind: "pages"; pages: unknown[] } | { kind: "none" };

interface Outcome {
  error: Error | null;
  provider: StubProvider;
  frsDir: string;
  /** The FR file's bytes, or null when none was written. */
  body: string | null;
}

async function runImport(mode: Mode, key: string, ctx: Ctx): Promise<Outcome> {
  const root = tempRoot(`${mode}-${key}`);
  writeClaudeMd(root, mode);
  const frsDir = join(root, "specs", "frs");
  mkdirSync(frsDir, { recursive: true });
  const provider = new StubProvider();
  const ownership: ImportOwnershipContext | undefined =
    ctx.kind === "ticket"
      ? ticketImportOwnership(root, ctx.ticket)
      : ctx.kind === "pages"
        ? { projectRoot: root, pages: ctx.pages }
        : undefined;
  let error: Error | null = null;
  try {
    await importFromTracker(mode, key, provider, join(root, "specs"), async () => "M_0cac80", ownership);
  } catch (e) {
    error = e as Error;
  }
  const file = join(frsDir, `${key}.md`);
  return { error, provider, frsDir, body: existsSync(file) ? readFileSync(file, "utf-8") : null };
}

/**
 * A refusal: thrown, nothing written under specs/frs/, no sync, and the
 * NFR-10 three-line shape naming the ticket (and `field`, when given).
 */
function expectRefusal(o: Outcome, mode: Mode, key: string, field: string | null): void {
  // The import must not have gone through.
  expect(o.body).toBeNull();
  expect(readdirSync(o.frsDir)).toEqual([]);
  expect(o.provider.syncCalls.length).toBe(0);
  expect(o.error).not.toBeNull();
  const msg = o.error!.message;
  const lines = msg.split("\n").filter((l) => l.trim() !== "");
  // NFR-10: verdict, Remedy:, Context: — the verdict first and naming the ticket.
  expect(lines.length).toBe(3);
  expect(lines[0]!.startsWith("Remedy:")).toBe(false);
  expect(lines[0]!.startsWith("Context:")).toBe(false);
  expect(lines[0]).toContain(key);
  expect(lines[1]!.startsWith("Remedy: ")).toBe(true);
  expect(lines[1]!.length).toBeGreaterThan("Remedy: ".length + 10);
  expect(lines[2]!.startsWith("Context: ")).toBe(true);
  expect(lines[2]).toContain(`mode=${mode}`);
  expect(lines[2]).toContain(`ticket=${key}`);
  if (field !== null) expect(msg).toContain(field);
}

/** Replace the `created_at:` timestamps (wall-clock) with a fixed token. */
const pinClock = (body: string): string =>
  body.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, "<CLOCK>");

/** Today's plain import, byte for byte, clock pinned. */
function plainGolden(mode: Mode, key: string): string {
  return `---
title: Ticket ${key}
milestone: M_0cac80
status: active
archived_at: null
tracker:
  ${mode}: ${key}
created_at: <CLOCK>
---

## Requirement

Filed from the board.

## Acceptance Criteria

- AC-${key}.1: Thing works.

## Technical Design

*(fill in during implementation)*

## Testing

*(fill in during implementation)*

## Notes

Imported from ${mode}:${key} on <CLOCK>.
`;
}

/** Today's bug import, byte for byte, clock pinned. */
function bugGolden(mode: Mode, key: string): string {
  return `---
title: Ticket ${key}
milestone: M_0cac80
status: active
archived_at: null
tracker:
  ${mode}: ${key}
created_at: <CLOCK>
changelog_category: Fixed
kind: bug
---

## Requirement

Filed from the board.

### Steps to reproduce

TODO — numbered steps from a clean state.

### Expected

TODO — what should happen.

### Actual

TODO — what happens instead.

## Acceptance Criteria

- AC-${key}.1: Thing works.
- AC-${key}.2: Regression: TODO — name the test that reproduces the reported failure; it fails before the fix and passes after it.

## Technical Design

*(fill in during implementation)*

### Root cause

TODO — why it happens (file:line, the faulty assumption).

## Testing

*(fill in during implementation)*

## Notes

Imported from ${mode}:${key} on <CLOCK>.
`;
}

// ===========================================================================
// AC-STE-682.1 — the regression
// ===========================================================================

describe("AC-STE-682.1 — regression", () => {
  test("a Linear item whose labels are not a list refuses the import", async () => {
    const o = await runImport("linear", "STE-1", { kind: "ticket", ticket: linearTicket("STE-1", null) });
    expectRefusal(o, "linear", "STE-1", "labels");
  });
});

// ===========================================================================
// AC-STE-682.2 — refusal cases, NFR-10 shape, before any write or sync
// ===========================================================================

describe("AC-STE-682.2 — an unreadable ticket refuses in the NFR-10 shape before any write or sync", () => {
  // Linear — the field bug detection reads is a `labels` list.
  test("Linear fetched ticket: `labels: null` refuses, naming `labels`", async () => {
    const o = await runImport("linear", "STE-2", { kind: "ticket", ticket: linearTicket("STE-2", null) });
    expectRefusal(o, "linear", "STE-2", "labels");
  });

  test("Linear fetched ticket: no `labels` key at all refuses, naming `labels`", async () => {
    const o = await runImport("linear", "STE-3", { kind: "ticket", ticket: linearTicket("STE-3", [], { labels: undefined }) });
    expectRefusal(o, "linear", "STE-3", "labels");
  });

  test("Linear fetched ticket: `labels` a string, not a list, refuses, naming `labels`", async () => {
    const o = await runImport("linear", "STE-4", { kind: "ticket", ticket: linearTicket("STE-4", "Bug") });
    expectRefusal(o, "linear", "STE-4", "labels");
  });

  test("Linear listing path: the page item for the ticket carries `labels: null` → refuses, naming `labels`", async () => {
    const page = linearPage(linearTicket("STE-5", ["area-x"]), linearTicket("STE-6", null));
    const o = await runImport("linear", "STE-6", { kind: "pages", pages: [page] });
    expectRefusal(o, "linear", "STE-6", "labels");
  });

  // Jira — the field bug detection reads is `fields.issuetype.name` as a string.
  test("Jira fetched ticket: no `fields.issuetype` refuses, naming `issuetype`", async () => {
    const o = await runImport("jira", "GF-1", { kind: "ticket", ticket: jiraTicket("GF-1", "Bug", { issuetype: undefined }) });
    expectRefusal(o, "jira", "GF-1", "issuetype");
  });

  test("Jira fetched ticket: `fields.issuetype.name` not a string refuses, naming `issuetype`", async () => {
    const o = await runImport("jira", "GF-2", {
      kind: "ticket",
      ticket: jiraTicket("GF-2", "Bug", { issuetype: { name: 42, hierarchyLevel: 0 } }),
    });
    expectRefusal(o, "jira", "GF-2", "issuetype");
  });

  test("Jira listing path: the page item for the ticket has no `fields.issuetype` → refuses, naming `issuetype`", async () => {
    const page = jiraPage(jiraTicket("GF-3", "Task"), jiraTicket("GF-4", "Bug", { issuetype: undefined }));
    const o = await runImport("jira", "GF-4", { kind: "pages", pages: [page] });
    expectRefusal(o, "jira", "GF-4", "issuetype");
  });

  // No readable answer holds the ticket (unshared binding).
  test("Linear listing pages that do not hold the ticket (unshared) refuse, naming the ticket", async () => {
    const page = linearPage(linearTicket("STE-7", ["Bug"]), linearTicket("STE-8", ["area-x"]));
    const o = await runImport("linear", "STE-9", { kind: "pages", pages: [page] });
    expectRefusal(o, "linear", "STE-9", null);
  });

  test("Jira listing pages that do not hold the ticket (unshared) refuse, naming the ticket", async () => {
    const page = jiraPage(jiraTicket("GF-5", "Bug"), jiraTicket("GF-6", "Task"));
    const o = await runImport("jira", "GF-7", { kind: "pages", pages: [page] });
    expectRefusal(o, "jira", "GF-7", null);
  });

  test("an ownership context with no pages and no fetched ticket refuses (no answer holds the ticket)", async () => {
    const o = await runImport("linear", "STE-10", { kind: "pages", pages: [] });
    expectRefusal(o, "linear", "STE-10", null);
  });
});

// ===========================================================================
// AC-STE-682.3 — readable tickets import as today
// ===========================================================================

describe("AC-STE-682.3 — a readable ticket imports exactly as today", () => {
  test("Linear readable non-bug (fetched) imports byte-identical to today", async () => {
    const o = await runImport("linear", "STE-20", { kind: "ticket", ticket: linearTicket("STE-20", ["area-x"]) });
    expect(o.error).toBeNull();
    expect(pinClock(o.body!)).toBe(plainGolden("linear", "STE-20"));
    expect(o.provider.syncCalls.length).toBe(1);
  });

  test("Linear readable non-bug with an EMPTY labels list imports byte-identical to today", async () => {
    const o = await runImport("linear", "STE-21", { kind: "ticket", ticket: linearTicket("STE-21", []) });
    expect(o.error).toBeNull();
    expect(pinClock(o.body!)).toBe(plainGolden("linear", "STE-21"));
  });

  test("Linear readable non-bug (listing page) imports byte-identical to today", async () => {
    const page = linearPage(linearTicket("STE-22", ["area-x"]), linearTicket("STE-23", ["Bug"]));
    const o = await runImport("linear", "STE-22", { kind: "pages", pages: [page] });
    expect(o.error).toBeNull();
    expect(pinClock(o.body!)).toBe(plainGolden("linear", "STE-22"));
  });

  test("Jira readable non-bug (fetched) imports byte-identical to today", async () => {
    const o = await runImport("jira", "GF-20", { kind: "ticket", ticket: jiraTicket("GF-20", "Task") });
    expect(o.error).toBeNull();
    expect(pinClock(o.body!)).toBe(plainGolden("jira", "GF-20"));
    expect(o.provider.syncCalls.length).toBe(1);
  });

  test("Jira readable non-bug (listing page) imports byte-identical to today", async () => {
    const page = jiraPage(jiraTicket("GF-21", "Story"), jiraTicket("GF-22", "Bug"));
    const o = await runImport("jira", "GF-21", { kind: "pages", pages: [page] });
    expect(o.error).toBeNull();
    expect(pinClock(o.body!)).toBe(plainGolden("jira", "GF-21"));
  });

  test("Linear readable bug (fetched, label objects) imports as today", async () => {
    const o = await runImport("linear", "STE-24", { kind: "ticket", ticket: linearTicket("STE-24", [{ name: "Bug" }]) });
    expect(o.error).toBeNull();
    expect(pinClock(o.body!)).toBe(bugGolden("linear", "STE-24"));
    expect(o.provider.syncCalls.length).toBe(1);
    expect(o.provider.syncCalls[0]!.frontmatter["kind"]).toBe("bug");
  });

  test("Linear readable bug (listing page) imports as today", async () => {
    const page = linearPage(linearTicket("STE-25", ["Bug"]));
    const o = await runImport("linear", "STE-25", { kind: "pages", pages: [page] });
    expect(o.error).toBeNull();
    expect(pinClock(o.body!)).toBe(bugGolden("linear", "STE-25"));
  });

  test("Jira readable bug (fetched) imports as today", async () => {
    const o = await runImport("jira", "GF-23", { kind: "ticket", ticket: jiraTicket("GF-23", "Bug") });
    expect(o.error).toBeNull();
    expect(pinClock(o.body!)).toBe(bugGolden("jira", "GF-23"));
    expect(o.provider.syncCalls[0]!.frontmatter["changelog_category"]).toBe("Fixed");
  });

  test("Jira readable bug (listing page) imports as today", async () => {
    const page = jiraPage(jiraTicket("GF-24", "Task"), jiraTicket("GF-25", "Bug"));
    const o = await runImport("jira", "GF-25", { kind: "pages", pages: [page] });
    expect(o.error).toBeNull();
    expect(pinClock(o.body!)).toBe(bugGolden("jira", "GF-25"));
  });

  test("control: with NO ownership context the import is unchanged (plain, synced)", async () => {
    for (const [mode, key] of [["linear", "STE-26"], ["jira", "GF-26"]] as const) {
      const o = await runImport(mode, key, { kind: "none" });
      expect(o.error).toBeNull();
      expect(pinClock(o.body!)).toBe(plainGolden(mode, key));
      expect(o.provider.syncCalls.length).toBe(1);
    }
  });
});

// ===========================================================================
// Phase 3 hardening — the refusal names the import, not one caller (review round 1)
// ===========================================================================

describe("STE-682 hardening — the Context line names the import, which /spec-write and /implement both reach", () => {
  test("an unreadable-ticket refusal carries skill=importFromTracker, not skill=spec-write", async () => {
    const o = await runImport("linear", "STE-40", { kind: "ticket", ticket: linearTicket("STE-40", null) });
    expectRefusal(o, "linear", "STE-40", "labels");
    const context = o.error!.message.split("\n").find((l) => l.startsWith("Context: "))!;
    expect(context).toContain("skill=importFromTracker");
    expect(context).not.toContain("skill=spec-write");
  });
});
