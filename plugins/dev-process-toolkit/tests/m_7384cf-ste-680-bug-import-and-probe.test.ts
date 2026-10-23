// M_7384cf / STE-680 — "Bug FRs are recognised on import and graded by the gate".
//
// WHAT THE IMPLEMENTER WRITES.
//
//   adapters/_shared/src/import.ts — `importFromTracker` reads the fetched
//   ticket handed in through `ticketImportOwnership(projectRoot, <ticket JSON>)`
//   and the bug type/label resolved by `resolveBugTrackerType(mode, binding)`
//   (workspace_binding.ts, STE-679) from `<projectRoot>/CLAUDE.md`:
//     * Jira  — `fields.issuetype.name` equals the resolved type
//               (`jira_bug_issue_type:`, default `Bug`);
//     * Linear — the issue's `labels` include the resolved label
//               (`linear_bug_label:`, default `Bug`).
//   A bug ticket's FR carries `changelog_category: Fixed` and `kind: bug`, the
//   four bug subsections (docs/resolver-entry.md § "Bug FR body") and a
//   `Regression:` AC — a TODO marker in each one the ticket does not supply.
//   Every other ticket imports byte-identical to today.
//
//   adapters/_shared/src/bug_fr_shape.ts
//     export function runBugFrShapeProbe(projectRoot: string): Report
//   plus an `if (import.meta.main)` front door, and registry row #88
//   (`bug_fr_shape`, **Severity: error**) in skills/gate-check/SKILL.md.
//
// THE CONTRACT (the house shape of probes #84-#86):
//
//   interface Violation {
//     file: string;      // repo-relative to projectRoot (specs/frs/<id>.md)
//     line: number;      // 1-based
//     reason: string;    // names the missing piece
//     note: string;      // `<file>:<line> — <reason>`
//     message: string;   // `bug_fr_shape: …` + `Remedy:` + `Context:` (probe=bug_fr_shape)
//     severity: "error";
//   }
//   interface Report { violations: Violation[]; notes: string[]; vacuous: boolean }
//
// Owed exports are reached dynamically, so a missing export reds one leg
// rather than failing module load for the whole file.
//
// Filter by AC with `bun test -t "AC-STE-680.N"`.

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { importFromTracker, ticketImportOwnership } from "../adapters/_shared/src/import";
import type { FRMetadata, FRSpec, LockResult, Provider, SyncResult } from "../adapters/_shared/src/provider";
import { parseFrontmatter } from "../adapters/_shared/src/frontmatter";

// ---------------------------------------------------------------------------
// Paths + helpers
// ---------------------------------------------------------------------------

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const README = join(REPO_ROOT, "README.md");
const GATE_CHECK_SKILL = join(PLUGIN_ROOT, "skills", "gate-check", "SKILL.md");
const SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src");

const PROBE_ID = "bug_fr_shape";
const PROBE_NUMBER = 88;
const MODULE_REL = "adapters/_shared/src/bug_fr_shape.ts";
const MODULE_ABS = join(PLUGIN_ROOT, ...MODULE_REL.split("/"));
const TEST_FILE_REL = "tests/m_7384cf-ste-680-bug-import-and-probe.test.ts";

const NTR_PLACEHOLDER = "[needs technical review — run /spec-write STE-901 to complete]";

const read = (p: string): string => readFileSync(p, "utf-8");

const roots: string[] = [];
function tempRoot(slug: string): string {
  const r = mkdtempSync(join(tmpdir(), `ste680-${slug}-`));
  roots.push(r);
  return r;
}
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

function writeRel(root: string, rel: string, body: string): void {
  const abs = join(root, ...rel.split("/"));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body);
}

// ===========================================================================
// Import fixtures (AC-STE-680.1 / .2)
// ===========================================================================

type Mode = "jira" | "linear";

/** A non-shared (undeclared repo_tag) CLAUDE.md, optionally carrying the STE-679 bug override. */
function writeClaudeMd(root: string, mode: Mode, bugOverride?: string): void {
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
  lines.push(mode === "jira" ? "project: GK" : "project: DPT");
  if (bugOverride !== undefined) {
    lines.push(mode === "jira" ? `jira_bug_issue_type: ${bugOverride}` : `linear_bug_label: ${bugOverride}`);
  }
  lines.push("", "## Verification", "", "run_cmd: none", "");
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "CLAUDE.md"), lines.join("\n"));
}

/** One Jira `getJiraIssue` result (shape as in tests/ticket-ownership-shared.test.ts). */
function jiraTicket(key: string, type: string, labels: string[] = []): Record<string, unknown> {
  return {
    key,
    fields: {
      summary: `Ticket ${key}`,
      labels: [...labels],
      issuetype: { name: type, hierarchyLevel: 0 },
      status: { name: "To Do" },
      project: { key: "GK" },
      creator: { displayName: "Someone" },
      description: "Filed from the board.",
    },
  };
}

/** One Linear `get_issue` answer in the measured shape. */
function linearTicket(key: string, labels: string[]): Record<string, unknown> {
  return {
    id: key,
    title: `Issue ${key}`,
    labels: [...labels],
    description: "Filed from the board.",
    createdBy: "Someone",
    project: "DPT",
    team: "Example Team Display Name",
    status: "Backlog",
  };
}

class StubProvider implements Provider {
  readonly mode = "tracker" as const;
  syncCalls: FRSpec[] = [];
  constructor(private readonly meta: { title: string; description: string; acs: string[] }) {}
  async listMilestones(): Promise<{ name: string }[]> {
    return [];
  }
  async listActiveFRs(): Promise<string[]> {
    return [];
  }
  async getMetadata(id: string): Promise<FRMetadata> {
    const m = {
      id,
      title: this.meta.title,
      milestone: "",
      status: "active",
      tracker: {},
      inFlightBranch: null,
      assignee: null,
    } as FRMetadata;
    (m as unknown as Record<string, unknown>)["description"] = this.meta.description;
    (m as unknown as Record<string, unknown>)["acs"] = this.meta.acs;
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

interface ImportCase {
  mode: Mode;
  key: string;
  ticket?: Record<string, unknown>;
  /** Orphan-listing path: the saved listing pages, with no fetched ticket. */
  pages?: unknown[];
  bugOverride?: string;
  acs?: string[];
  description?: string;
}

/** Import one ticket into a fresh root; return the FR file's bytes. */
async function importOne(c: ImportCase): Promise<string> {
  const root = tempRoot(`imp-${c.mode}`);
  writeClaudeMd(root, c.mode, c.bugOverride);
  mkdirSync(join(root, "specs", "frs"), { recursive: true });
  const provider = new StubProvider({
    title: `Ticket ${c.key}`,
    description: c.description ?? "Filed from the board.",
    acs: c.acs ?? ["Thing works."],
  });
  await importFromTracker(
    c.mode,
    c.key,
    provider,
    join(root, "specs"),
    async () => "M_7384cf",
    c.ticket !== undefined
      ? ticketImportOwnership(root, c.ticket)
      : c.pages !== undefined
        ? { projectRoot: root, pages: c.pages }
        : undefined,
  );
  return read(join(root, "specs", "frs", `${c.key}.md`));
}

const fm = (body: string): Record<string, unknown> => parseFrontmatter(body) as Record<string, unknown>;

/** Replace the `created_at:` timestamps (wall-clock) with a fixed token. */
const pinClock = (body: string): string =>
  body.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, "<CLOCK>");

/** Today's import, byte for byte (renderFRFile before STE-680), clock pinned. */
function golden(mode: Mode, key: string): string {
  return `---
title: Ticket ${key}
milestone: M_7384cf
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

/** Body of a `### <heading>` subsection (up to the next heading), or null when the heading is absent. */
function subsection(body: string, heading: string): string | null {
  const lines = body.split("\n");
  const i = lines.findIndex((l) => l.trim() === `### ${heading}`);
  if (i < 0) return null;
  const out: string[] = [];
  for (const l of lines.slice(i + 1)) {
    if (/^#{1,3} /.test(l)) break;
    out.push(l);
  }
  return out.join("\n").trim();
}

/** The `## <name>` section a `### <heading>` sits under. */
function parentSection(body: string, heading: string): string | null {
  const lines = body.split("\n");
  const i = lines.findIndex((l) => l.trim() === `### ${heading}`);
  if (i < 0) return null;
  for (let j = i - 1; j >= 0; j--) {
    const m = /^## (.+)$/.exec(lines[j]!);
    if (m) return m[1]!.trim();
  }
  return null;
}

const acLines = (body: string): string[] => body.split("\n").filter((l) => /^- AC-[A-Za-z0-9_.-]+: /.test(l));
const acBody = (line: string): string => line.replace(/^- AC-[A-Za-z0-9_.-]+: /, "");

// ===========================================================================
// AC-STE-680.1 — import recognises a bug ticket; everything else is unchanged
// ===========================================================================

describe("AC-STE-680.1 — a tracker bug imports as `kind: bug` + `changelog_category: Fixed`", () => {
  test("orphan-listing path: a Jira Bug read from the listing page (no fetched ticket) → kind: bug, Fixed", async () => {
    const page = { issues: [jiraTicket("GK-540", "Task"), jiraTicket("GK-541", "Bug")], isLast: true };
    const f = fm(await importOne({ mode: "jira", key: "GK-541", pages: [page] }));
    expect(f["kind"]).toBe("bug");
    expect(f["changelog_category"]).toBe("Fixed");
    const task = fm(await importOne({ mode: "jira", key: "GK-540", pages: [page] }));
    expect(task["kind"]).toBeUndefined();
  });

  test("orphan-listing path: a Bug-labelled Linear issue read from the listing page → kind: bug, Fixed", async () => {
    const page = { issues: [linearTicket("STE-542", ["Feature"]), linearTicket("STE-543", ["Bug"])], hasNextPage: false };
    const f = fm(await importOne({ mode: "linear", key: "STE-543", pages: [page] }));
    expect(f["kind"]).toBe("bug");
    expect(f["changelog_category"]).toBe("Fixed");
    const feature = fm(await importOne({ mode: "linear", key: "STE-542", pages: [page] }));
    expect(feature["kind"]).toBeUndefined();
  });

  test("a Jira ticket whose issuetype.name is the default resolved type `Bug` → kind: bug, Fixed", async () => {
    const body = await importOne({ mode: "jira", key: "GK-501", ticket: jiraTicket("GK-501", "Bug") });
    const f = fm(body);
    expect(f["kind"]).toBe("bug");
    expect(f["changelog_category"]).toBe("Fixed");
  });

  test("a Jira ticket whose issuetype.name equals the configured `jira_bug_issue_type` → kind: bug, Fixed", async () => {
    const body = await importOne({
      mode: "jira",
      key: "GK-502",
      bugOverride: "Defect",
      ticket: jiraTicket("GK-502", "Defect"),
    });
    const f = fm(body);
    expect(f["kind"]).toBe("bug");
    expect(f["changelog_category"]).toBe("Fixed");
  });

  test("a Linear issue whose labels include the default resolved label `Bug` → kind: bug, Fixed", async () => {
    const body = await importOne({ mode: "linear", key: "STE-901", ticket: linearTicket("STE-901", ["area-x", "Bug"]) });
    const f = fm(body);
    expect(f["kind"]).toBe("bug");
    expect(f["changelog_category"]).toBe("Fixed");
  });

  test("a Linear issue whose labels include the configured `linear_bug_label` → kind: bug, Fixed", async () => {
    const body = await importOne({
      mode: "linear",
      key: "STE-902",
      bugOverride: "Defect",
      ticket: linearTicket("STE-902", ["Defect"]),
    });
    const f = fm(body);
    expect(f["kind"]).toBe("bug");
    expect(f["changelog_category"]).toBe("Fixed");
  });

  test("control: today's import (no fetched ticket) is the golden bytes", async () => {
    expect(pinClock(await importOne({ mode: "jira", key: "GK-510" }))).toBe(golden("jira", "GK-510"));
    expect(pinClock(await importOne({ mode: "linear", key: "STE-910" }))).toBe(golden("linear", "STE-910"));
  });

  test("a plain Jira Task imports byte-identical to today", async () => {
    const body = await importOne({ mode: "jira", key: "GK-511", ticket: jiraTicket("GK-511", "Task") });
    expect(pinClock(body)).toBe(golden("jira", "GK-511"));
  });

  test("a Jira `Bug` when the resolved type is `Defect` is NOT a bug — byte-identical to today", async () => {
    const body = await importOne({
      mode: "jira",
      key: "GK-512",
      bugOverride: "Defect",
      ticket: jiraTicket("GK-512", "Bug"),
    });
    expect(pinClock(body)).toBe(golden("jira", "GK-512"));
  });

  test("a Jira ticket merely LABELLED `Bug` (issuetype Task) is NOT a bug — byte-identical to today", async () => {
    const body = await importOne({ mode: "jira", key: "GK-513", ticket: jiraTicket("GK-513", "Task", ["Bug"]) });
    expect(pinClock(body)).toBe(golden("jira", "GK-513"));
  });

  test("a Linear issue without the bug label imports byte-identical to today", async () => {
    const body = await importOne({ mode: "linear", key: "STE-911", ticket: linearTicket("STE-911", ["area-x"]) });
    expect(pinClock(body)).toBe(golden("linear", "STE-911"));
  });

  test("a Linear `Bug` label when the resolved label is `Defect` is NOT a bug — byte-identical to today", async () => {
    const body = await importOne({
      mode: "linear",
      key: "STE-912",
      bugOverride: "Defect",
      ticket: linearTicket("STE-912", ["Bug"]),
    });
    expect(pinClock(body)).toBe(golden("linear", "STE-912"));
  });
});

// ===========================================================================
// AC-STE-680.2 — an imported bug FR carries the bug body, TODO where unsupplied
// ===========================================================================

describe("AC-STE-680.2 — an imported bug FR gets the four bug subsections and a `Regression:` AC", () => {
  const PIECES: readonly (readonly [string, string])[] = [
    ["Steps to reproduce", "Requirement"],
    ["Expected", "Requirement"],
    ["Actual", "Requirement"],
    ["Root cause", "Technical Design"],
  ];

  for (const mode of ["jira", "linear"] as const) {
    const key = mode === "jira" ? "GK-520" : "STE-920";
    const ticket = mode === "jira" ? jiraTicket(key, "Bug") : linearTicket(key, ["Bug"]);

    for (const [heading, parent] of PIECES) {
      test(`${mode}: \`### ${heading}\` sits under \`## ${parent}\` and holds a TODO marker`, async () => {
        const body = await importOne({ mode, key, ticket });
        expect(parentSection(body, heading)).toBe(parent);
        expect(subsection(body, heading)).toMatch(/TODO/);
      });
    }

    test(`${mode}: a \`Regression:\` AC holding a TODO marker is added when the ticket supplies none`, async () => {
      const body = await importOne({ mode, key, ticket, acs: ["Login works again."] });
      const regression = acLines(body).filter((l) => acBody(l).startsWith("Regression:"));
      expect(regression.length).toBe(1);
      expect(regression[0]).toMatch(/TODO/);
      // The ticket's own AC survives alongside it.
      expect(acLines(body).some((l) => acBody(l) === "Login works again.")).toBe(true);
    });

    test(`${mode}: a ticket-supplied \`Regression:\` AC is kept and no TODO regression AC is added`, async () => {
      const supplied = "Regression: `tests/login.test.ts › sso` fails before the fix and passes after it.";
      const body = await importOne({ mode, key, ticket, acs: [supplied] });
      const regression = acLines(body).filter((l) => acBody(l).startsWith("Regression:"));
      expect(regression.map(acBody)).toEqual([supplied]);
    });
  }

  test("a non-bug import gains none of the bug subsections and no Regression: AC", async () => {
    const body = await importOne({ mode: "jira", key: "GK-521", ticket: jiraTicket("GK-521", "Story") });
    for (const [heading] of PIECES) expect(subsection(body, heading)).toBeNull();
    expect(acLines(body).some((l) => acBody(l).startsWith("Regression:"))).toBe(false);
  });
});

// ===========================================================================
// Probe fixtures (AC-STE-680.3 / .4 / .5)
// ===========================================================================

interface Violation {
  readonly file: string;
  readonly line: number;
  readonly reason: string;
  readonly note: string;
  readonly message: string;
  readonly severity: string;
}
interface Report {
  readonly violations: readonly Violation[];
  readonly notes: readonly string[];
  readonly vacuous: boolean;
}
type ProbeFn = (projectRoot: string) => Report | Promise<Report>;

async function probe(): Promise<ProbeFn> {
  if (!existsSync(MODULE_ABS)) {
    throw new Error(`${MODULE_REL} does not exist — no probe grades a bug FR's shape`);
  }
  const mod = (await import(MODULE_ABS)) as Record<string, unknown>;
  const fn = mod["runBugFrShapeProbe"];
  if (typeof fn !== "function") throw new Error(`${MODULE_REL} does not export \`runBugFrShapeProbe\``);
  return fn as ProbeFn;
}

async function runOn(root: string): Promise<Report> {
  const run = await probe();
  return await run(root);
}

function assertHouseShape(v: Violation, fileRel: string): void {
  expect(v.severity).toBe("error");
  expect(v.file).toBe(fileRel);
  expect(v.line).toBeGreaterThan(0);
  expect(v.reason.length).toBeGreaterThan(10);
  expect(v.note).toBe(`${fileRel}:${v.line} — ${v.reason}`);
  expect(v.message.startsWith(`${PROBE_ID}: `)).toBe(true);
  const lines = v.message.split("\n");
  expect(lines.some((l) => l.startsWith("Remedy: "))).toBe(true);
  expect(lines.some((l) => l.startsWith("Context: "))).toBe(true);
  expect(v.message).toContain(`probe=${PROBE_ID}`);
}

interface BugFrOpts {
  id?: string;
  status?: string;
  kind?: string | null;
  category?: string | null;
  ntr?: boolean;
  steps?: string | null;
  expected?: string | null;
  actual?: string | null;
  rootCause?: string | null;
  techDesignExtra?: string;
  acs?: string[];
}

const GOOD_STEPS = "1. Open the login page.\n2. Click Sign in with SSO.";
const GOOD_EXPECTED = "The dashboard opens.";
const GOOD_ACTUAL = "A 500 error: `TypeError: token is undefined`.";
const GOOD_ROOT = "`src/auth.ts:42` assumes the SSO token is always present.";
const GOOD_ACS = [
  "Regression: `tests/auth.test.ts › sso token` fails before the fix and passes after it.",
  "The SSO login lands on the dashboard.",
];

/** A bug FR body; each piece `null` omits its heading entirely. Defaults are a complete, well-formed bug FR. */
function bugFr(o: BugFrOpts = {}): string {
  const id = o.id ?? "STE-901";
  const fmLines = [
    "---",
    `title: Bug ${id}`,
    "milestone: M_7384cf",
    `status: ${o.status ?? "active"}`,
    "archived_at: null",
    "tracker:",
    `  linear: ${id}`,
  ];
  if (o.ntr) fmLines.push("needs_technical_review: true");
  fmLines.push("created_at: 2026-10-20T00:00:00Z");
  const category = o.category === undefined ? "Fixed" : o.category;
  if (category !== null) fmLines.push(`changelog_category: ${category}`);
  const kind = o.kind === undefined ? "bug" : o.kind;
  if (kind !== null) fmLines.push(`kind: ${kind}`);
  fmLines.push("---", "");

  const sec = (heading: string, value: string | null | undefined, dflt: string): string[] => {
    const v = value === undefined ? dflt : value;
    return v === null ? [] : [`### ${heading}`, "", v, ""];
  };
  const acs = o.acs ?? GOOD_ACS;
  return [
    ...fmLines,
    `# Bug ${id}`,
    "",
    "## Requirement",
    "",
    ...sec("Steps to reproduce", o.steps, GOOD_STEPS),
    ...sec("Expected", o.expected, GOOD_EXPECTED),
    ...sec("Actual", o.actual, GOOD_ACTUAL),
    "## Acceptance Criteria",
    "",
    ...acs.map((a, i) => `- AC-${id}.${i + 1}: ${a}`),
    "",
    "## Technical Design",
    "",
    ...(o.techDesignExtra !== undefined ? [o.techDesignExtra, ""] : []),
    ...sec("Root cause", o.rootCause, GOOD_ROOT),
    "## Testing",
    "",
    "Unit test.",
    "",
  ].join("\n");
}

function project(frs: Record<string, string>): string {
  const root = tempRoot("probe");
  mkdirSync(join(root, "specs", "frs", "archive"), { recursive: true });
  for (const [rel, body] of Object.entries(frs)) writeRel(root, rel, body);
  return root;
}

const FR_REL = "specs/frs/STE-901.md";

/** Violations whose reason names `piece` (case-insensitive). */
const naming = (r: Report, piece: string): Violation[] =>
  r.violations.filter((v) => v.reason.toLowerCase().includes(piece.toLowerCase()));

// ===========================================================================
// AC-STE-680.3 — the shape arm
// ===========================================================================

describe("AC-STE-680.3 — probe #88 grades each active bug FR's pieces, one violation per missing piece", () => {
  test("a complete bug FR is clean", async () => {
    const r = await runOn(project({ [FR_REL]: bugFr() }));
    expect(r.violations).toEqual([]);
    expect(r.notes).toEqual([]);
  });

  const SECTIONS: readonly (readonly [keyof BugFrOpts, string])[] = [
    ["steps", "Steps to reproduce"],
    ["expected", "Expected"],
    ["actual", "Actual"],
  ];

  for (const [opt, piece] of SECTIONS) {
    test(`a missing \`### ${piece}\` is exactly one violation naming it`, async () => {
      const r = await runOn(project({ [FR_REL]: bugFr({ [opt]: null }) }));
      expect(r.violations.length).toBe(1);
      expect(naming(r, piece).length).toBe(1);
      assertHouseShape(r.violations[0]!, FR_REL);
    });

    test(`a TODO-only \`### ${piece}\` is exactly one violation naming it`, async () => {
      const r = await runOn(project({ [FR_REL]: bugFr({ [opt]: "TODO: fill in from the ticket." }) }));
      expect(r.violations.length).toBe(1);
      expect(naming(r, piece).length).toBe(1);
    });

    test(`an empty \`### ${piece}\` is exactly one violation naming it`, async () => {
      const r = await runOn(project({ [FR_REL]: bugFr({ [opt]: "" }) }));
      expect(r.violations.length).toBe(1);
      expect(naming(r, piece).length).toBe(1);
    });
  }

  test("a missing `### Root cause` on an unflagged FR is exactly one violation naming it", async () => {
    const r = await runOn(project({ [FR_REL]: bugFr({ rootCause: null }) }));
    expect(r.violations.length).toBe(1);
    expect(naming(r, "Root cause").length).toBe(1);
    assertHouseShape(r.violations[0]!, FR_REL);
  });

  test("the needs-technical-review placeholder satisfies Root cause on a flagged FR", async () => {
    const r = await runOn(
      project({ [FR_REL]: bugFr({ ntr: true, rootCause: null, techDesignExtra: NTR_PLACEHOLDER }) }),
    );
    expect(r.violations).toEqual([]);
  });

  test("the placeholder does NOT satisfy Root cause on an UNflagged FR", async () => {
    const r = await runOn(project({ [FR_REL]: bugFr({ rootCause: null, techDesignExtra: NTR_PLACEHOLDER }) }));
    expect(r.violations.length).toBe(1);
    expect(naming(r, "Root cause").length).toBe(1);
  });

  test("the placeholder INSIDE `### Root cause` does NOT satisfy it on an UNflagged FR", async () => {
    const r = await runOn(project({ [FR_REL]: bugFr({ rootCause: NTR_PLACEHOLDER }) }));
    expect(r.violations.length).toBe(1);
    expect(naming(r, "Root cause").length).toBe(1);
    const flagged = await runOn(project({ [FR_REL]: bugFr({ ntr: true, rootCause: NTR_PLACEHOLDER }) }));
    expect(flagged.violations).toEqual([]);
  });

  test("the flag alone (no placeholder, no Root cause) does NOT satisfy Root cause", async () => {
    const r = await runOn(project({ [FR_REL]: bugFr({ ntr: true, rootCause: null }) }));
    expect(r.violations.length).toBe(1);
    expect(naming(r, "Root cause").length).toBe(1);
  });

  test("no AC beginning `Regression:` is exactly one violation naming the regression criterion", async () => {
    const r = await runOn(
      project({ [FR_REL]: bugFr({ acs: ["The SSO login lands on the dashboard.", "Covered by a Regression: test."] }) }),
    );
    expect(r.violations.length).toBe(1);
    expect(naming(r, "Regression").length).toBe(1);
    assertHouseShape(r.violations[0]!, FR_REL);
  });

  test("every piece missing at once is five violations, one per piece", async () => {
    const r = await runOn(
      project({
        [FR_REL]: bugFr({
          steps: null,
          expected: "TODO",
          actual: null,
          rootCause: null,
          acs: ["The SSO login lands on the dashboard."],
        }),
      }),
    );
    expect(r.violations.length).toBe(5);
    for (const piece of ["Steps to reproduce", "Expected", "Actual", "Root cause", "Regression"]) {
      expect(naming(r, piece).length, piece).toBeGreaterThanOrEqual(1);
    }
    expect(r.notes).toEqual(r.violations.map((v) => v.note));
    for (const v of r.violations) assertHouseShape(v, FR_REL);
  });

  test("each broken bug FR is graded on its own — two broken FRs, two files named", async () => {
    const r = await runOn(
      project({
        [FR_REL]: bugFr({ steps: null }),
        "specs/frs/STE-902.md": bugFr({ id: "STE-902", actual: null }),
      }),
    );
    expect(r.violations.map((v) => v.file).sort()).toEqual(["specs/frs/STE-901.md", "specs/frs/STE-902.md"]);
  });

  test("a freshly imported TODO bug FR is red until its pieces are filled", async () => {
    const root = tempRoot("imp-probe");
    writeClaudeMd(root, "jira");
    mkdirSync(join(root, "specs", "frs"), { recursive: true });
    await importFromTracker(
      "jira",
      "GK-530",
      new StubProvider({ title: "Ticket GK-530", description: "Filed from the board.", acs: ["Thing works."] }),
      join(root, "specs"),
      async () => "M_7384cf",
      ticketImportOwnership(root, jiraTicket("GK-530", "Bug")),
    );
    const r = await runOn(root);
    for (const piece of ["Steps to reproduce", "Expected", "Actual"]) {
      expect(naming(r, piece).length, piece).toBe(1);
    }
    expect(naming(r, "Root cause").length).toBe(1);
    // Steps / Expected / Actual / Root cause / Regression; since AC-STE-681.3 the
    // imported TODO `Regression:` AC no longer satisfies its piece.
    expect(r.violations.length).toBe(5);
    expect(r.vacuous).toBe(false);
  });
});

// ===========================================================================
// AC-STE-680.4 — the coherence arm, and what is never graded
// ===========================================================================

describe("AC-STE-680.4 — coherence: a bug is Fixed or Security; `bug` is the only kind", () => {
  test("`kind: bug` with `changelog_category: Security` is clean", async () => {
    const r = await runOn(project({ [FR_REL]: bugFr({ category: "Security" }) }));
    expect(r.violations).toEqual([]);
  });

  for (const category of ["Added", "Changed", "Removed"]) {
    test(`\`kind: bug\` with \`changelog_category: ${category}\` is exactly one violation naming the category`, async () => {
      const r = await runOn(project({ [FR_REL]: bugFr({ category }) }));
      expect(r.violations.length).toBe(1);
      const v = r.violations[0]!;
      assertHouseShape(v, FR_REL);
      expect(v.reason).toContain(category);
      expect(v.reason.toLowerCase()).toContain("changelog_category");
    });
  }

  test("`kind: bug` with NO changelog_category is a violation (outside {Fixed, Security})", async () => {
    const r = await runOn(project({ [FR_REL]: bugFr({ category: null }) }));
    expect(r.violations.length).toBe(1);
    expect(r.violations[0]!.reason.toLowerCase()).toContain("changelog_category");
  });

  for (const kind of ["feature", "Bug", "defect"]) {
    test(`\`kind: ${kind}\` on an active FR is a violation naming the kind`, async () => {
      const r = await runOn(project({ [FR_REL]: bugFr({ kind }) }));
      const named = r.violations.filter((v) => v.reason.includes(kind));
      expect(named.length).toBe(1);
      assertHouseShape(named[0]!, FR_REL);
    });
  }

  test("an FR with no `kind:` key is never graded, however unlike a bug it looks", async () => {
    const r = await runOn(
      project({
        [FR_REL]: bugFr({
          kind: null,
          category: "Added",
          steps: null,
          expected: null,
          actual: null,
          rootCause: null,
          acs: ["It works."],
        }),
      }),
    );
    expect(r.violations).toEqual([]);
  });

  test("an archived bug FR (specs/frs/archive/) is never graded", async () => {
    const r = await runOn(
      project({
        "specs/frs/archive/STE-901.md": bugFr({ status: "archived", category: "Added", steps: null, rootCause: null }),
      }),
    );
    expect(r.violations).toEqual([]);
  });

  test("an archived FR with a foreign `kind:` is never graded", async () => {
    const r = await runOn(project({ "specs/frs/archive/STE-901.md": bugFr({ status: "archived", kind: "feature" }) }));
    expect(r.violations).toEqual([]);
  });
});

// ===========================================================================
// AC-STE-680.5 — vacuity is measured
// ===========================================================================

describe("AC-STE-680.5 — `vacuous` is true exactly when no active FR carries `kind: bug`", () => {
  test("no specs/ at all → vacuous", async () => {
    const r = await runOn(tempRoot("empty"));
    expect(r.vacuous).toBe(true);
    expect(r.violations).toEqual([]);
  });

  test("only non-bug active FRs → vacuous", async () => {
    const r = await runOn(project({ [FR_REL]: bugFr({ kind: null, category: "Added" }) }));
    expect(r.vacuous).toBe(true);
  });

  test("a bug FR only in the archive → vacuous", async () => {
    const r = await runOn(project({ "specs/frs/archive/STE-901.md": bugFr({ status: "archived" }) }));
    expect(r.vacuous).toBe(true);
  });

  test("an active FR with a foreign kind (not `bug`) → still vacuous, though it is a violation", async () => {
    const r = await runOn(project({ [FR_REL]: bugFr({ kind: "feature" }) }));
    expect(r.vacuous).toBe(true);
    expect(r.violations.length).toBeGreaterThan(0);
  });

  test("one clean active bug FR → NOT vacuous", async () => {
    const r = await runOn(project({ [FR_REL]: bugFr() }));
    expect(r.vacuous).toBe(false);
    expect(r.violations).toEqual([]);
  });

  test("one broken active bug FR → NOT vacuous", async () => {
    const r = await runOn(project({ [FR_REL]: bugFr({ steps: null }) }));
    expect(r.vacuous).toBe(false);
  });

  test("the real repository is graded without throwing", async () => {
    const r = await runOn(REPO_ROOT);
    expect(typeof r.vacuous).toBe("boolean");
    expect(Array.isArray(r.violations)).toBe(true);
  });
});

// ===========================================================================
// AC-STE-680.6 — registration as probe #88, front door, #81 green
// ===========================================================================

function probeRegistrationLines(): { number: number; line: string }[] {
  return read(GATE_CHECK_SKILL)
    .split("\n")
    .flatMap((line) => {
      const m = /^(\d+)\. \*\*/.exec(line);
      return m === null ? [] : [{ number: Number(m[1]), line }];
    });
}

/** The count before this FR registered its probe — no surface may still read it. */
const PREVIOUS_PROBE_COUNT = 87;
/** The live registry count. Amended by AC-STE-693.6: probe count 88 -> 89 (probe #89 landed after #88). */
const LIVE_PROBE_COUNT = 89;

/** Probe-count pins (the STE-673.6 table): after #88, none may still read 87. */
const PINS: readonly (readonly [string, string])[] = [
  ["README.md", "{N} numbered `/gate-check` probes"],
  ["README.md", String.raw`layers {N} probes`],
  ["docs/workflow-overview.md", "+ {N} probes"],
  ["docs/workflow-overview.md", "| {N} conformance probes"],
  ["tests/gate-check-active-plan-ship-ready.test.ts", String.raw`expect(numbers.length).toBe({N});`],
  ["tests/gate-check-active-plan-ship-ready.test.ts", String.raw`Array.from({ length: {N} }, (_, i) => i + 1)`],
  ["tests/gate-check-best-practices-manifest-hygiene.test.ts", String.raw`expect(numbers.length).toBe({N});`],
  ["tests/gate-check-best-practices-manifest-hygiene.test.ts", String.raw`Array.from({ length: {N} }, (_, i) => i + 1)`],
  ["tests/gate-check-spec-write-next-line-doc.test.ts", String.raw`"{N} numbered"`],
  ["tests/gate-check-spec-write-next-line-doc.test.ts", String.raw`layers {N} probes`],
  ["tests/gate-check-spec-write-next-line-doc.test.ts", String.raw`expect(Math.max(...numbers)).toBe({N});`],
  ["tests/gate-check-spec-write-next-line-doc.test.ts", String.raw`expect(Number(counted![1])).toBe({N});`],
  ["tests/m109-ste-394-docs-pins.test.ts", String.raw`\b{N}\b\s+numbered`],
  ["tests/m120-ste-443-jira-plan-provenance.test.ts", String.raw`expect(Math.max(...numbers)).toBe({N});`],
  ["tests/m120-ste-443-jira-plan-provenance.test.ts", String.raw`expect(numbers.length).toBe({N});`],
  ["tests/m137-ste-534-fr-word-caps.test.ts", "{N} numbered `/gate-check` probes"],
  ["tests/m137-ste-534-fr-word-caps.test.ts", String.raw`expect(Math.max(...numbers)).toBe({N});`],
  ["tests/m137-ste-533-stage-block-adoption.test.ts", String.raw`Array.from({ length: {N} }, (_, i) => i + 1)`],
  ["tests/m137-ste-533-stage-block-adoption.test.ts", String.raw`expect(live).toBe({N});`],
  ["tests/m140-ste-543-external-link-verdicts.test.ts", String.raw`const NEW_PROBE_COUNT = {N};`],
  ["tests/m_685ff6-ste-612-probe25-leg.test.ts", String.raw`Array.from({ length: {N} }, (_, i) => i + 1)`],
  ["tests/m_8f07e0-ste-583-spans-repos.test.ts", String.raw`expect(hits.length).toBe({N});`],
  ["tests/m_2306b6-ste-616-shared-tracker-scenarios.test.ts", String.raw`gm)].length).toBe({N});`],
  ["tests/m_6c25dd-ste-659-milestone-name-unasked.test.ts", String.raw`const EXPECTED_PROBE_COUNT = {N};`],
  ["tests/m_866092-ste-673-video-commit-nudge.test.ts", String.raw`const EXPECTED_PROBE_COUNT = {N};`],
] as const;

const fill = (template: string, n: number): string => template.split("{N}").join(String(n));
const surfaceAbs = (rel: string): string => (rel === "README.md" ? README : join(PLUGIN_ROOT, ...rel.split("/")));

describe("AC-STE-680.6 — registered as probe #88 behind an `import.meta.main` front door", () => {
  // Amended by AC-STE-693.6: probe count 88 -> 89.
  test("the registry is contiguous 1..89", () => {
    expect(probeRegistrationLines().map((r) => r.number)).toEqual(
      Array.from({ length: LIVE_PROBE_COUNT }, (_, i) => i + 1),
    );
  });

  test("probe #88 is `bug_fr_shape`, severity error, in the house idiom", () => {
    const hits = probeRegistrationLines().filter((r) => r.line.includes(MODULE_REL));
    expect(hits.length).toBe(1);
    const row = hits[0]!;
    expect(row.number).toBe(PROBE_NUMBER);
    expect(row.line.startsWith(`${PROBE_NUMBER}. **\`${PROBE_ID}\`**`)).toBe(true);
    expect(row.line).toContain(`call \`runBugFrShapeProbe(projectRoot)\` from \`${MODULE_REL}\``);
    expect(row.line).toContain("**Severity: error**");
    expect(row.line).toContain("vacuous");
    expect(row.line).toContain(TEST_FILE_REL);
  });

  test("the probe module carries an `if (import.meta.main)` front door", () => {
    expect(existsSync(MODULE_ABS)).toBe(true);
    expect(read(MODULE_ABS)).toContain("if (import.meta.main)");
  });

  test("the front door exits 1 with the violation messages on a broken bug FR, 0 on a clean one", () => {
    const broken = project({ [FR_REL]: bugFr({ steps: null }) });
    const bad = Bun.spawnSync(["bun", "run", MODULE_ABS, broken], { stdout: "pipe", stderr: "pipe" });
    expect(bad.exitCode).toBe(1);
    expect(bad.stdout.toString() + bad.stderr.toString()).toContain(`${PROBE_ID}: ${FR_REL}`);
    const clean = project({ [FR_REL]: bugFr() });
    const good = Bun.spawnSync(["bun", "run", MODULE_ABS, clean], { stdout: "pipe", stderr: "pipe" });
    expect(good.exitCode).toBe(0);
  });

  test("probe #81 grades every reference to the probe module REACHABLE", async () => {
    const mod = (await import(join(SRC, "module_reachability.ts"))) as {
      runModuleReachabilityProbe: (root: string) => Promise<{
        records: { module: string; reachable: boolean; surface: string; line: number }[];
      }>;
    };
    const report = await mod.runModuleReachabilityProbe(REPO_ROOT);
    const records = report.records.filter((r) => r.module.includes(MODULE_REL));
    // ANTI-VACUITY: the registration row is a reference; zero means the walk never saw it.
    expect(records.length, `no shipped surface references ${MODULE_REL}`).toBeGreaterThan(0);
    expect(records.filter((r) => !r.reachable)).toEqual([]);
  });

  // Amended by AC-STE-693.6: the next unregistered number is #90 at 89 live registrations.
  test("the front-door warning names the NEXT unregistered number (#90)", () => {
    const skill = read(GATE_CHECK_SKILL);
    expect(skill).toContain(`registering probe #${LIVE_PROBE_COUNT + 1} will turn probe #81 red`);
    expect(skill).not.toContain(`registering probe #${PROBE_NUMBER} will turn probe #81 red`);
  });

  test("no probe-count pin still reads 87", () => {
    const stale: string[] = [];
    for (const [rel, template] of PINS) {
      // A pinned surface that no longer exists is a broken pin, never a pass.
      if (!existsSync(surfaceAbs(rel))) {
        stale.push(`${rel} — missing`);
        continue;
      }
      if (read(surfaceAbs(rel)).includes(fill(template, PREVIOUS_PROBE_COUNT))) {
        stale.push(`${rel} — ${fill(template, PREVIOUS_PROBE_COUNT)}`);
      }
    }
    expect(stale).toEqual([]);
  });

  // Amended by AC-STE-693.6: probe count 88 -> 89.
  test("the prose surfaces (README, workflow overview) state 89 probes", () => {
    for (const [rel, template] of PINS.filter(([rel]) => !rel.startsWith("tests/"))) {
      expect({ rel, has: read(surfaceAbs(rel)).includes(fill(template, LIVE_PROBE_COUNT)) }).toEqual({ rel, has: true });
    }
  });

  test("gate-check SKILL.md stays within the NFR-1 line cap (358)", () => {
    expect(read(GATE_CHECK_SKILL).split("\n").length).toBeLessThanOrEqual(358);
  });
});

// ===========================================================================
// Phase 3 hardening — review findings (M_7384cf)
// ===========================================================================

describe("Phase 3 hardening — probe and import edges", () => {
  test("a TODO-only Root cause is exactly one Root cause violation", async () => {
    const r = await runOn(project({ [FR_REL]: bugFr({ rootCause: "TODO — later." }) }));
    expect(naming(r, "root cause")).toHaveLength(1);
    expect(r.violations).toHaveLength(1);
  });

  test("Linear labels given as {name} objects are recognised", async () => {
    const ticket = { ...linearTicket("STE-905", []), labels: [{ id: "l1", name: "Bug" }] };
    const body = await importOne({ mode: "linear", key: "STE-905", ticket });
    expect(fm(body)["kind"]).toBe("bug");
  });

  test("a subsection the ticket already supplies is kept, not duplicated with a TODO", async () => {
    const description = "### Steps to reproduce\n\n1. Open login.\n2. Click SSO.\n\n### Expected\n\nDashboard.\n\n### Actual\n\nA 500.";
    const body = await importOne({ mode: "jira", key: "GK-906", ticket: jiraTicket("GK-906", "Bug"), description });
    for (const h of ["Steps to reproduce", "Expected", "Actual"]) {
      expect(body.split("\n").filter((l) => l === `### ${h}`)).toHaveLength(1);
    }
    expect(subsection(body, "Steps to reproduce")).not.toMatch(/TODO/);
    expect(subsection(body, "Root cause")).toMatch(/TODO/);
  });
});
