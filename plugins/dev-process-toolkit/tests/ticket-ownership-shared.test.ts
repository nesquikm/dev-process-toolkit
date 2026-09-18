// STE-606 (M_947c79) — /implement confirms a ticket is this repository's
// before importing or claiming it.
//
// Every behavioural leg SPAWNS the front doors of
// `adapters/_shared/src/ticket_ownership.ts` over `makeSpanFixture` roots
// (`a` = FE `glacy-fe`, `b` = BE `glacy-be`) initialised as REAL git
// repositories, because ownership reads the FR bindings tracked in the git
// index, never a file merely present on disk.
//
// ---------------------------------------------------------------------------
// OUTPUT CONTRACT these legs read (the FR fixes the verbs; this file fixes the
// framing the implementer satisfies):
// ---------------------------------------------------------------------------
//   `ticket_ownership.ts decide <projectRoot> <ticket.json>`
//     - readable input: exit 0 and exactly one stdout line that parses as a
//       JSON object carrying `verdict` (one of `owned | foreign-project |
//       container | foreign-repo | unowned`), `key`, and `tracked` — the
//       NUMBER of FR bindings read from the files `git ls-files` lists under
//       `specs/frs/` and `specs/frs/archive/`. Outside a git repository
//       `tracked` is 0 and the JSON line names git (e.g. "not a git
//       repository"), rather than treating anything as owned.
//     - `unowned`: the output also carries the adopt question's option labels
//       `Adopt <KEY>` and `Skip <KEY>`; no other verdict prints `Adopt <KEY>`.
//     - `foreign-repo`: the output (stdout or stderr) names running from the
//       owning repository and a person relabelling the ticket.
//     - unreadable input (missing file, non-JSON, no `project`, or no `labels`
//       when shared): exit non-zero, no verdict line.
//   `ticket_ownership.ts confirm <projectRoot> <key> <ticket.json> [--adopt]`
//     - shared + `owned` (or `unowned` with `--adopt`): exit 0, one
//       `dpt-receipt: <path>` line, a `binding` receipt whose subject is the key.
//     - any refused verdict, `unowned` without `--adopt`, or unreadable input:
//       exit non-zero, zero files written.
//     - undeclared + `owned`: exit 0, no receipt line, zero files written.
//
// Session: `CLAUDE_CODE_SESSION_ID` is set explicitly for every spawn.
// Filter by AC with `bun test -t "AC-STE-606.N"`.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importFromTracker } from "../adapters/_shared/src/import";
import {
  ORDERED_UNREACHABLE_PIN,
  ORDERED_UNREACHABLE_PIN_LEDGER,
  runModuleReachabilityProbe,
} from "../adapters/_shared/src/module_reachability";
import { renderSharedTrackerSentinel } from "../adapters/_shared/src/setup/tracker_binding_write";
import type { AdapterDriver, TicketStatusSummary, UpsertMetadataInput } from "../adapters/_shared/src/tracker_provider";
import { TrackerProvider } from "../adapters/_shared/src/tracker_provider";
import { RECEIPT_ANNOUNCEMENT_PREFIX, readSessionReceipts } from "../adapters/_shared/src/tracker_receipts";
import {
  BE_TAG,
  boundFr,
  declareJira,
  declareLinear,
  FE_TAG,
  PLUGIN_ROOT,
  REPO_ROOT,
  type Run,
  snapshotTree,
  spawnModule,
} from "./_orphan_pages";
import { makeSpanFixture, pluginManifest } from "./_span_fixture";

const OWNERSHIP = join(PLUGIN_ROOT, "adapters", "_shared", "src", "ticket_ownership.ts");
const SESSION = `ste606-${process.pid}`;
const REFUSED = ["foreign-project", "container", "foreign-repo"] as const;

let manifestDir = "";
let scratch = "";

beforeAll(() => {
  manifestDir = mkdtempSync(join(tmpdir(), "dpt-ste606-manifest-"));
  pluginManifest(manifestDir, "2.87.0");
  scratch = mkdtempSync(join(tmpdir(), "dpt-ste606-tickets-"));
});

afterAll(() => {
  rmSync(manifestDir, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

const env = () => ({ CLAUDE_PLUGIN_ROOT: manifestDir, CLAUDE_CODE_SESSION_ID: SESSION });

// ------------------------------------------------------------------ tickets

interface JiraOpts {
  key: string;
  labels?: string[];
  type?: string;
  project?: string;
  title?: string;
}

/** One Jira `getJiraIssue` result with the fields the decision reads. */
function jiraTicket(o: JiraOpts): Record<string, unknown> {
  const type = o.type ?? "Task";
  return {
    key: o.key,
    fields: {
      summary: o.title ?? `Ticket ${o.key}`,
      labels: [...(o.labels ?? [])],
      issuetype: { name: type, hierarchyLevel: type === "Epic" ? 1 : 0 },
      status: { name: "To Do" },
      project: { key: o.project ?? "GF" },
      creator: { displayName: "Someone" },
      description: "Filed from the board.",
    },
  };
}

/** One Linear `get_issue` result. */
function linearTicket(o: { key: string; labels?: string[]; project?: string; team?: string }): Record<string, unknown> {
  return {
    id: o.key,
    identifier: o.key,
    title: `Issue ${o.key}`,
    labels: [...(o.labels ?? [])],
    description: "Filed from the board.",
    createdBy: "Someone",
    project: o.project ?? "DPT",
    team: o.team ?? "STE",
    state: "Backlog",
  };
}

let ticketSeq = 0;
function writeTicket(ticket: unknown): string {
  ticketSeq += 1;
  const p = join(scratch, `ticket-${ticketSeq}.json`);
  writeFileSync(p, typeof ticket === "string" ? ticket : JSON.stringify(ticket));
  return p;
}

// ------------------------------------------------------------------ running

const decide = (root: string, ticketPath: string): Run => spawnModule(OWNERSHIP, ["decide", root, ticketPath], env());
const confirm = (root: string, key: string, ticketPath: string, adopt = false): Run =>
  spawnModule(OWNERSHIP, ["confirm", root, key, ticketPath, ...(adopt ? ["--adopt"] : [])], env());

/** The one JSON line carrying `verdict`, or null. */
function verdictJson(run: Run): Record<string, unknown> | null {
  for (const line of run.stdout.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      const j = JSON.parse(t) as Record<string, unknown>;
      if (typeof j["verdict"] === "string") return j;
    } catch {
      // not the verdict line
    }
  }
  return null;
}

function verdictOf(root: string, ticket: unknown): string {
  const run = decide(root, writeTicket(ticket));
  expect(run.code, `decide failed\nstdout=${run.stdout}\nstderr=${run.stderr}`).toBe(0);
  const j = verdictJson(run);
  expect(j, `no verdict JSON line\nstdout=${run.stdout}\nstderr=${run.stderr}`).not.toBeNull();
  return j!["verdict"] as string;
}

const receiptsOf = (root: string) => readSessionReceipts(root, SESSION).receipts;

/** confirm must refuse and write nothing anywhere under `root`. */
function expectRefusedNothingWritten(root: string, key: string, ticketPath: string, adopt = false): void {
  const before = snapshotTree(root);
  const run = confirm(root, key, ticketPath, adopt);
  expect(run.code, `confirm ${key} should refuse\nstdout=${run.stdout}\nstderr=${run.stderr}`).not.toBe(0);
  expect(run.stdout).not.toContain(RECEIPT_ANNOUNCEMENT_PREFIX);
  expect(receiptsOf(root)).toEqual([]);
  expect(snapshotTree(root)).toEqual(before);
}

/** confirm must succeed and write exactly one `binding` receipt for `key`. */
function expectBindingReceipt(root: string, key: string, ticketPath: string, adopt = false): void {
  const run = confirm(root, key, ticketPath, adopt);
  expect(run.code, `confirm ${key} failed\nstdout=${run.stdout}\nstderr=${run.stderr}`).toBe(0);
  const line = run.stdout.split("\n").find((l) => l.startsWith(RECEIPT_ANNOUNCEMENT_PREFIX));
  expect(line, `no receipt line\n${run.stdout}`).toBeDefined();
  expect(existsSync(line!.slice(RECEIPT_ANNOUNCEMENT_PREFIX.length).trim())).toBe(true);
  const receipts = receiptsOf(root).filter((r) => r.subject === key);
  expect(receipts.length).toBe(1);
  expect(receipts[0]!.kind).toBe("binding");
}

// ------------------------------------------------------------------ git

function git(cwd: string, args: string[]): string {
  const proc = Bun.spawnSync(
    [
      "git",
      "-c",
      "user.email=fixture@example.com",
      "-c",
      "user.name=Fixture",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      ...args,
    ],
    { cwd, stdout: "pipe", stderr: "pipe" },
  );
  if (proc.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${proc.stderr.toString()}`);
  }
  return proc.stdout.toString();
}

function gitInit(root: string): void {
  git(root, ["init", "-q", "-b", "main"]);
  // No background gc/maintenance racing a test's filesystem reads.
  git(root, ["config", "gc.auto", "0"]);
  git(root, ["config", "maintenance.auto", "false"]);
  commitAll(root, "init");
}

function commitAll(root: string, msg: string): void {
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "--no-verify", "--allow-empty", "-m", msg]);
}

/** A tracked, archived FR under `specs/frs/archive/<key>.md` bound to `key`. */
function archivedBoundFr(root: string, key: string): void {
  mkdirSync(join(root, "specs", "frs", "archive"), { recursive: true });
  writeFileSync(
    join(root, "specs", "frs", "archive", `${key}.md`),
    [
      "---",
      `title: ${key}`,
      "milestone: M_GF_80",
      "status: archived",
      "archived_at: 2026-09-01T00:00:00Z",
      "tracker:",
      `  jira: ${key}`,
      "---",
      "",
      `# ${key}`,
      "",
    ].join("\n"),
  );
}

function withRoots<T>(body: (fe: string, be: string) => T | Promise<T>): Promise<T> {
  const fx = makeSpanFixture("M_GF_85");
  return Promise.resolve()
    .then(() => body(realpathSync(fx.a), realpathSync(fx.b)))
    .finally(() => fx.cleanup());
}

/** Both roots declared shared on Jira GF and initialised as git repositories. */
function withSharedGitRoots<T>(body: (fe: string, be: string) => T | Promise<T>): Promise<T> {
  return withRoots((fe, be) => {
    declareJira(fe, FE_TAG);
    declareJira(be, BE_TAG);
    gitInit(fe);
    gitInit(be);
    return body(fe, be);
  });
}

// ===========================================================================
// AC-STE-606.1 — verdicts forbid.
// ===========================================================================

describe("AC-STE-606.1 — verdicts forbid", () => {
  test("BE deciding FE's tagged ticket → foreign-repo; the remedy names the owning repository and relabelling; confirm refuses, no receipt", async () => {
    await withSharedGitRoots((_fe, be) => {
      const t = writeTicket(jiraTicket({ key: "GF-101", labels: [FE_TAG] }));
      const run = decide(be, t);
      expect(run.code, run.stderr).toBe(0);
      expect(verdictJson(run)?.["verdict"]).toBe("foreign-repo");
      const said = `${run.stdout}\n${run.stderr}`;
      expect(said).toMatch(/owning repositor/i);
      expect(said).toMatch(/relabel/i);
      expect(said).not.toContain("Adopt GF-101");
      expectRefusedNothingWritten(be, "GF-101", t);
      expectRefusedNothingWritten(be, "GF-101", t, true);
    });
  });

  test("a GB ticket under BE's GF binding → foreign-project; confirm refuses, no receipt", async () => {
    await withSharedGitRoots((_fe, be) => {
      const t = writeTicket(jiraTicket({ key: "GB-41", labels: [BE_TAG], project: "GB" }));
      expect(verdictOf(be, JSON.parse(readFileSync(t, "utf-8")))).toBe("foreign-project");
      expectRefusedNothingWritten(be, "GB-41", t);
    });
  });

  test("a Linear issue from another project → foreign-project (control: the same issue in DPT is owned); confirm refuses, no receipt", async () => {
    await withRoots((_fe, be) => {
      declareLinear(be, BE_TAG);
      gitInit(be);
      expect(verdictOf(be, linearTicket({ key: "STE-900", labels: [BE_TAG], project: "DPT" }))).toBe("owned");
      const t = writeTicket(linearTicket({ key: "STE-901", labels: [BE_TAG], project: "Other Project" }));
      expect(verdictOf(be, JSON.parse(readFileSync(t, "utf-8")))).toBe("foreign-project");
      expectRefusedNothingWritten(be, "STE-901", t);
    });
  });

  test("an Epic → container, even carrying this repository's tag; confirm refuses, no receipt", async () => {
    await withSharedGitRoots((_fe, be) => {
      const t = writeTicket(jiraTicket({ key: "GF-85", labels: [BE_TAG], type: "Epic" }));
      expect(verdictOf(be, JSON.parse(readFileSync(t, "utf-8")))).toBe("container");
      expectRefusedNothingWritten(be, "GF-85", t);
      expectRefusedNothingWritten(be, "GF-85", t, true);
    });
  });
});

// ===========================================================================
// AC-STE-606.2 — verdicts permit.
// ===========================================================================

describe("AC-STE-606.2 — verdicts permit", () => {
  test("BE's own tagged ticket → owned; confirm writes one binding receipt", async () => {
    await withSharedGitRoots((_fe, be) => {
      const t = writeTicket(jiraTicket({ key: "GF-111", labels: [BE_TAG] }));
      expect(verdictOf(be, JSON.parse(readFileSync(t, "utf-8")))).toBe("owned");
      expectBindingReceipt(be, "GF-111", t);
    });
  });

  test("the reverse direction: FE deciding BE's tagged ticket → foreign-repo, FE's own → owned", async () => {
    await withSharedGitRoots((fe) => {
      expect(verdictOf(fe, jiraTicket({ key: "GF-111", labels: [BE_TAG] }))).toBe("foreign-repo");
      expect(verdictOf(fe, jiraTicket({ key: "GF-101", labels: [FE_TAG] }))).toBe("owned");
    });
  });

  test("a legacy GB ticket bound by a TRACKED BE FR file after BE was re-pointed to GF → owned; confirm writes the receipt", async () => {
    await withSharedGitRoots((_fe, be) => {
      boundFr(be, "GB-41");
      commitAll(be, "legacy binding");
      const t = writeTicket(jiraTicket({ key: "GB-41", labels: [], project: "GB" }));
      expect(verdictOf(be, JSON.parse(readFileSync(t, "utf-8")))).toBe("owned");
      expectBindingReceipt(be, "GB-41", t);
    });
  });

  test("a binding tracked under specs/frs/archive/ also makes its key owned", async () => {
    await withSharedGitRoots((_fe, be) => {
      archivedBoundFr(be, "GF-160");
      commitAll(be, "archived binding");
      expect(verdictOf(be, jiraTicket({ key: "GF-160", labels: [FE_TAG] }))).toBe("owned");
    });
  });

  test("an unowned ticket → unowned with the adopt options; confirm refuses without --adopt (zero files) and writes the receipt with it", async () => {
    await withSharedGitRoots((_fe, be) => {
      const t = writeTicket(jiraTicket({ key: "GF-121", labels: ["milestone-M_GF_85"] }));
      const run = decide(be, t);
      expect(run.code, run.stderr).toBe(0);
      expect(verdictJson(run)?.["verdict"]).toBe("unowned");
      expect(run.stdout).toContain("Adopt GF-121");
      expect(run.stdout).toContain("Skip GF-121");
      expectRefusedNothingWritten(be, "GF-121", t);
      expectBindingReceipt(be, "GF-121", t, true);
    });
  });

  test("an owned verdict offers no adopt question", async () => {
    await withSharedGitRoots((_fe, be) => {
      const run = decide(be, writeTicket(jiraTicket({ key: "GF-111", labels: [BE_TAG] })));
      expect(verdictJson(run)?.["verdict"]).toBe("owned");
      expect(run.stdout).not.toContain("Adopt GF-111");
    });
  });

  test("control: an UNTRACKED FR file just written in BE for FE's ticket does not make it owned", async () => {
    await withSharedGitRoots((_fe, be) => {
      boundFr(be, "GF-101");
      const t = writeTicket(jiraTicket({ key: "GF-101", labels: [FE_TAG] }));
      expect(verdictOf(be, JSON.parse(readFileSync(t, "utf-8")))).toBe("foreign-repo");
      expectRefusedNothingWritten(be, "GF-101", t);
    });
  });

  test("control: an UNTRACKED FR file for an unlabelled ticket leaves it unowned, not owned", async () => {
    await withSharedGitRoots((_fe, be) => {
      boundFr(be, "GF-122");
      expect(verdictOf(be, jiraTicket({ key: "GF-122", labels: [] }))).toBe("unowned");
    });
  });

  test("control: an untracked FR for a GB ticket does not vouch across projects", async () => {
    await withSharedGitRoots((_fe, be) => {
      boundFr(be, "GB-42");
      expect(verdictOf(be, jiraTicket({ key: "GB-42", labels: [], project: "GB" }))).toBe("foreign-project");
    });
  });
});

// ===========================================================================
// AC-STE-606.3 — the join path.
// ===========================================================================

class RecordingDriver implements AdapterDriver {
  readonly trackerKey = "jira";
  writes: { op: string; ticketId: string | null; receiptBefore: boolean }[] = [];
  constructor(
    readonly root: string,
    readonly key: string,
  ) {}
  private receiptPresent(): boolean {
    return receiptsOf(this.root).some((r) => r.kind === "binding" && r.subject === this.key);
  }
  async pullAcs(): Promise<unknown[]> {
    return [];
  }
  async pushAcToggle(ticketId: string): Promise<void> {
    this.writes.push({ op: "pushAcToggle", ticketId, receiptBefore: this.receiptPresent() });
  }
  async transitionStatus(ticketId: string): Promise<void> {
    this.writes.push({ op: "transitionStatus", ticketId, receiptBefore: this.receiptPresent() });
  }
  async upsertTicketMetadata(ticketId: string | null, _meta: UpsertMetadataInput): Promise<string> {
    this.writes.push({ op: "upsertTicketMetadata", ticketId, receiptBefore: this.receiptPresent() });
    return ticketId ?? "GF-NEW";
  }
  async getTicketStatus(): Promise<TicketStatusSummary> {
    return { status: "backlog", assignee: null };
  }
  getUrl(id: string): string {
    return `https://example.atlassian.net/browse/${id}`;
  }
}

/**
 * The 0.b′ sequence on a local miss: decide → (confirmation) → confirm → import.
 * A refused verdict or a refused confirm stops before the import.
 */
async function joinOnMiss(root: string, key: string, ticket: unknown, adopt: boolean, driver: RecordingDriver) {
  const t = writeTicket(ticket);
  const d = decide(root, t);
  const verdict = verdictJson(d)?.["verdict"];
  if (d.code !== 0 || typeof verdict !== "string" || (REFUSED as readonly string[]).includes(verdict)) {
    return { verdict, imported: false };
  }
  const c = confirm(root, key, t, adopt);
  if (c.code !== 0) return { verdict, imported: false };
  expect(existsSync(join(root, "specs", "frs", `${key}.md`)), "the key must be a local miss").toBe(false);
  const provider = new TrackerProvider({
    driver,
    currentUser: "be-dev",
    resolveTrackerRef: async (s: string) => s.replace(/^jira:/, ""),
  });
  await importFromTracker("jira", key, provider, join(root, "specs"), async () => "M_GF_85");
  return { verdict, imported: true };
}

describe("AC-STE-606.3 — the join path", () => {
  test("an import on miss of an `ours` ticket yields a binding receipt before any tracker write", async () => {
    await withSharedGitRoots(async (_fe, be) => {
      const driver = new RecordingDriver(be, "GF-111");
      const out = await joinOnMiss(be, "GF-111", jiraTicket({ key: "GF-111", labels: [BE_TAG] }), false, driver);
      expect(out.verdict).toBe("owned");
      expect(out.imported).toBe(true);
      expect(driver.writes.length).toBeGreaterThan(0);
      for (const w of driver.writes) expect(w.receiptBefore, `${w.op} ran before the receipt`).toBe(true);
      expect(existsSync(join(be, "specs", "frs", "GF-111.md"))).toBe(true);
    });
  });

  test("an import of an `unowned` ticket without the adopt answer writes nothing (control: with it, it imports)", async () => {
    await withSharedGitRoots(async (_fe, be) => {
      const before = snapshotTree(be);
      const driver = new RecordingDriver(be, "GF-121");
      const out = await joinOnMiss(be, "GF-121", jiraTicket({ key: "GF-121", labels: [] }), false, driver);
      expect(out.verdict).toBe("unowned");
      expect(out.imported).toBe(false);
      expect(driver.writes).toEqual([]);
      expect(receiptsOf(be)).toEqual([]);
      expect(snapshotTree(be)).toEqual(before);

      const adopted = await joinOnMiss(be, "GF-121", jiraTicket({ key: "GF-121", labels: [] }), true, driver);
      expect(adopted.imported).toBe(true);
      for (const w of driver.writes) expect(w.receiptBefore).toBe(true);
    });
  });

  test("a ticket id taken from the branch name gets the same verdicts as one passed as an argument", async () => {
    await withSharedGitRoots((_fe, be) => {
      const tickets = [
        jiraTicket({ key: "GF-111", labels: [BE_TAG] }),
        jiraTicket({ key: "GF-101", labels: [FE_TAG] }),
        jiraTicket({ key: "GF-121", labels: [] }),
        jiraTicket({ key: "GB-41", labels: [BE_TAG], project: "GB" }),
      ];
      const byKey = new Map(tickets.map((t) => [t["key"] as string, t]));
      const expected: Record<string, string> = {
        "GF-111": "owned",
        "GF-101": "foreign-repo",
        "GF-121": "unowned",
        "GB-41": "foreign-project",
      };
      for (const [key, want] of Object.entries(expected)) {
        const argVerdict = verdictOf(be, byKey.get(key));
        git(be, ["checkout", "-q", "-b", `feat/${key.toLowerCase()}-${key}-work`]);
        const branch = git(be, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
        const fromBranch = /[A-Z][A-Z0-9]{1,9}-[0-9]+/.exec(branch)?.[0];
        expect(fromBranch).toBe(key);
        const branchVerdict = verdictOf(be, byKey.get(fromBranch!));
        expect(argVerdict).toBe(want);
        expect(branchVerdict).toBe(argVerdict);
        git(be, ["checkout", "-q", "main"]);
      }
    });
  });
});

// ===========================================================================
// AC-STE-606.4 — one routing table (the runbook half; the provider half is in
// adapters/_shared/src/tracker_provider.test.ts).
// ===========================================================================

describe("AC-STE-606.4 — the runbook's documented routing is claimRoute's", () => {
  const doc = () => readFileSync(join(PLUGIN_ROOT, "docs", "implement-tracker-mode.md"), "utf-8");
  const runbook = () => {
    const d = doc();
    const start = d.search(/^## Claim runbook/m);
    expect(start).toBeGreaterThan(-1);
    const rest = d.slice(start + 1);
    const next = rest.search(/^## /m);
    return next === -1 ? rest : rest.slice(0, next);
  };

  test("§ Claim runbook has a step 0 requiring an owned or adopted verdict, and routes through claimRoute", () => {
    const s = runbook();
    const step0 = s.split("\n").find((l) => /^0\.\s/.test(l.trim()));
    expect(step0, "no step 0 in § Claim runbook").toBeDefined();
    const step0Block = s.slice(s.indexOf(step0!), s.search(/^1\.\s/m));
    expect(step0Block).toMatch(/\bowned\b/);
    expect(step0Block).toMatch(/adopt/i);
    expect(s).toContain("claimRoute");
  });

  test("done AND completed route to already-released in the runbook", () => {
    const s = runbook();
    const released = s.split("\n").filter((l) => l.includes("already-released"));
    expect(released.some((l) => /completed/i.test(l)), "no already-released line names completed").toBe(true);
  });
});

// ===========================================================================
// AC-STE-606.5 — the order in prose, graded structurally.
// ===========================================================================

describe("AC-STE-606.5 — the confirmation precedes import and claim", () => {
  const read = (p: string) => readFileSync(p, "utf-8");
  const IMPLEMENT = join(PLUGIN_ROOT, "skills", "implement", "SKILL.md");
  const SPEC_WRITE = join(PLUGIN_ROOT, "skills", "spec-write", "SKILL.md");
  const TICKET_BINDING = join(PLUGIN_ROOT, "docs", "ticket-binding.md");
  const RESOLVER_ENTRY = join(PLUGIN_ROOT, "docs", "resolver-entry.md");

  const lineIndex = (lines: string[], marker: string) => lines.findIndex((l) => l.includes(marker));

  test("implement 0.b′: decide, then the confirmation, then importFromTracker; 0.b′ precedes 0.c", () => {
    const lines = read(IMPLEMENT).split("\n");
    const at = lineIndex(lines, "**0.b′ Resolver entry**");
    const claimAt = lineIndex(lines, "**0.c Claim**");
    expect(at).toBeGreaterThan(-1);
    expect(claimAt).toBeGreaterThan(at);
    const line = lines[at]!;
    const iDecide = line.search(/\bdecide\b/);
    const iConfirmation = line.search(/confirmation/i);
    const iImport = line.indexOf("importFromTracker");
    expect(iDecide, "0.b′ never names `decide`").toBeGreaterThan(-1);
    expect(iConfirmation, "0.b′ never names the confirmation").toBeGreaterThan(-1);
    expect(iImport).toBeGreaterThan(-1);
    expect(iDecide).toBeLessThan(iConfirmation);
    expect(iConfirmation).toBeLessThan(iImport);
    expect(line.lastIndexOf("0.c")).toBeGreaterThan(iDecide);
    expect(line).toMatch(/adopt/i);
  });

  test("implement 0.f: the ticket-binding bullet says the confirmation already ran at 0.b′, and the branch-name route runs decide before 0.c", () => {
    const lines = read(IMPLEMENT).split("\n");
    const f = lineIndex(lines, "**0.f Tracker-mode probe**");
    expect(f).toBeGreaterThan(-1);
    const bullet = lines.slice(f, f + 6).find((l) => l.includes("**Ticket-binding pre-flight**"));
    expect(bullet, "no Ticket-binding pre-flight bullet under 0.f").toBeDefined();
    expect(bullet!).toContain("0.b′");
    expect(bullet!).toMatch(/branch/i);
    expect(bullet!).toMatch(/\bdecide\b/);
    expect(bullet!).toContain("0.c");
  });

  test("spec-write § 0a Miss: the decision and the confirmation precede importFromTracker; the line points at resolver-entry and orders no command", () => {
    const lines = read(SPEC_WRITE).split("\n");
    const at = lines.findIndex((l) => l.trim().startsWith("- **Miss**"));
    expect(at).toBeGreaterThan(-1);
    const line = lines[at]!;
    const iImport = line.indexOf("importFromTracker");
    expect(iImport).toBeGreaterThan(-1);
    const iDecide = line.search(/\bdecide\b|ownership/i);
    const iConfirm = line.search(/confirm/i);
    expect(iDecide, "Miss never names the ownership decision").toBeGreaterThan(-1);
    expect(iConfirm, "Miss never names the confirmation").toBeGreaterThan(-1);
    expect(iDecide).toBeLessThan(iImport);
    expect(iConfirm).toBeLessThan(iImport);
    expect(line).toContain("resolver-entry.md");
    expect(line).not.toMatch(/bun run/);
  });

  test("docs/ticket-binding.md: decide is ordered before the prompt, and the /implement row says before import and claim", () => {
    const doc = read(TICKET_BINDING);
    const iPrompt = doc.indexOf("Operating on ticket <ID>");
    const iDecide = doc.search(/\bdecide\b/);
    expect(iPrompt).toBeGreaterThan(-1);
    expect(iDecide, "ticket-binding.md never names decide").toBeGreaterThan(-1);
    expect(iDecide).toBeLessThan(iPrompt);
    const row = doc.split("\n").find((l) => l.startsWith("| `/implement` |"));
    expect(row).toBeDefined();
    expect(row!).toMatch(/before import and claim/i);
  });

  test("docs/resolver-entry.md: the miss row runs decide before importFromTracker", () => {
    const row = read(RESOLVER_ENTRY)
      .split("\n")
      .find((l) => l.includes("find-by-tracker-ref miss"));
    expect(row).toBeDefined();
    const iDecide = row!.search(/\bdecide\b/);
    expect(iDecide, "the miss row never names decide").toBeGreaterThan(-1);
    expect(iDecide).toBeLessThan(row!.indexOf("importFromTracker"));
  });
});

// ===========================================================================
// AC-STE-606.6 — unreadable and absent input.
// ===========================================================================

describe("AC-STE-606.6 — unreadable and absent input", () => {
  test("missing, non-JSON, no project, and (shared) no labels: decide refuses, confirm refuses with no receipt", async () => {
    await withSharedGitRoots((_fe, be) => {
      // Control: the complete ticket decides, so each refusal below is the input's.
      expect(verdictOf(be, jiraTicket({ key: "GF-111", labels: [BE_TAG] }))).toBe("owned");
      const noProject = jiraTicket({ key: "GF-111", labels: [BE_TAG] });
      delete (noProject["fields"] as Record<string, unknown>)["project"];
      const noLabels = jiraTicket({ key: "GF-111", labels: [BE_TAG] });
      delete (noLabels["fields"] as Record<string, unknown>)["labels"];
      const cases: Record<string, string> = {
        missing: join(scratch, "no-such-ticket.json"),
        "non-JSON": writeTicket("{ this is not json"),
        "no project": writeTicket(noProject),
        "no labels": writeTicket(noLabels),
      };
      for (const [name, p] of Object.entries(cases)) {
        const d = decide(be, p);
        expect(d.code, `${name}: decide should refuse\n${d.stdout}`).not.toBe(0);
        expect(verdictJson(d), `${name}: decide printed a verdict`).toBeNull();
        expectRefusedNothingWritten(be, "GF-111", p);
      }
    });
  });

  test("a root that is not a git repository has an empty tracked set: an on-disk binding is not owned, and the verdict says so", async () => {
    await withRoots((_fe, be) => {
      declareJira(be, BE_TAG);
      boundFr(be, "GF-150");
      const run = decide(be, writeTicket(jiraTicket({ key: "GF-150", labels: [] })));
      expect(run.code, run.stderr).toBe(0);
      const j = verdictJson(run);
      expect(j).not.toBeNull();
      expect(j!["verdict"]).not.toBe("owned");
      expect(j!["verdict"]).toBe("unowned");
      expect(j!["tracked"]).toBe(0);
      expect(JSON.stringify(j)).toMatch(/git/i);
    });
  });
});

// ===========================================================================
// AC-STE-606.7 — relocated: tracked-ness is read per tree.
// ===========================================================================

describe("AC-STE-606.7 — two worktrees of BE", () => {
  test("the worktree with the FR committed → owned; the one without → the classification verdict", async () => {
    const wtParent = mkdtempSync(join(tmpdir(), "dpt-ste606-wt-"));
    let be = "";
    const withFr = join(realpathSync(wtParent), "with-fr");
    const without = join(realpathSync(wtParent), "without-fr");
    try {
      await withSharedGitRoots((_fe, b) => {
        be = b;
        git(be, ["worktree", "add", "-q", "-b", "with-fr", withFr]);
        git(be, ["worktree", "add", "-q", "-b", "without-fr", without]);
        boundFr(withFr, "GF-150");
        commitAll(withFr, "bind GF-150");
        const ticket = jiraTicket({ key: "GF-150", labels: [] });
        expect(verdictOf(withFr, ticket)).toBe("owned");
        expect(verdictOf(without, ticket)).toBe("unowned");
        expect(verdictOf(be, ticket)).toBe("unowned");
        const tagged = jiraTicket({ key: "GF-150", labels: [FE_TAG] });
        expect(verdictOf(withFr, tagged)).toBe("owned");
        expect(verdictOf(without, tagged)).toBe("foreign-repo");
        for (const wt of [withFr, without]) git(be, ["worktree", "remove", "--force", wt]);
      });
    } finally {
      rmSync(wtParent, { recursive: true, force: true });
    }
  });
});

// ===========================================================================
// AC-STE-606.8 — undeclared repositories.
// ===========================================================================

describe("AC-STE-606.8 — undeclared repositories", () => {
  test("Jira: same project → owned, different project → foreign-project; no receipt either way", async () => {
    await withRoots((_fe, be) => {
      declareJira(be, null);
      gitInit(be);
      const same = writeTicket(jiraTicket({ key: "GF-121", labels: [] }));
      const other = writeTicket(jiraTicket({ key: "GB-41", labels: [], project: "GB" }));
      expect(verdictOf(be, JSON.parse(readFileSync(same, "utf-8")))).toBe("owned");
      expect(verdictOf(be, JSON.parse(readFileSync(other, "utf-8")))).toBe("foreign-project");

      const before = snapshotTree(be);
      const ok = confirm(be, "GF-121", same);
      expect(ok.code, ok.stderr).toBe(0);
      expect(ok.stdout).not.toContain(RECEIPT_ANNOUNCEMENT_PREFIX);
      expect(snapshotTree(be)).toEqual(before);
      expectRefusedNothingWritten(be, "GB-41", other);
      expect(receiptsOf(be)).toEqual([]);
    });
  });

  test("Linear: same project → owned, other project → foreign-project", async () => {
    await withRoots((_fe, be) => {
      declareLinear(be, null);
      gitInit(be);
      expect(verdictOf(be, linearTicket({ key: "STE-900" }))).toBe("owned");
      const other = writeTicket(linearTicket({ key: "STE-901", project: "Other Project" }));
      expect(verdictOf(be, JSON.parse(readFileSync(other, "utf-8")))).toBe("foreign-project");
      expectRefusedNothingWritten(be, "STE-901", other);
    });
  });
});

// ===========================================================================
// AC-STE-606.9 — old clients read the stop paragraph.
// ===========================================================================

describe("AC-STE-606.9 — the stop paragraph names both guarded writes", () => {
  test("renderSharedTrackerSentinel names import and transition, for both adapters", () => {
    for (const adapter of ["jira", "linear"] as const) {
      const text = renderSharedTrackerSentinel({
        adapter,
        project: "GF",
        repoTag: BE_TAG,
        minDptVersion: "2.87.0",
      });
      const stop = text.split("\n").find((l) => /\bdo not\b/i.test(l));
      expect(stop, "no stop sentence").toBeDefined();
      expect(stop!).toMatch(/\bimport\b/);
      expect(stop!).toMatch(/\btransition\b/);
    }
  });
});

// ===========================================================================
// AC-STE-606.10 — budgets hold.
// ===========================================================================

describe("AC-STE-606.10 — budgets", () => {
  const read = (p: string) => readFileSync(p, "utf-8");
  const steTokens = (s: string) => (s.match(/STE-\d+/g) ?? []).length;

  test("skills/implement/SKILL.md: exactly 358 split-lines and 41 STE tokens", () => {
    const body = read(join(PLUGIN_ROOT, "skills", "implement", "SKILL.md"));
    expect(body.split("\n").length).toBe(358);
    expect(steTokens(body)).toBe(41);
  });

  test("skills/spec-write/SKILL.md: 358 split-lines and 54 STE tokens", () => {
    const body = read(join(PLUGIN_ROOT, "skills", "spec-write", "SKILL.md"));
    expect(body.split("\n").length).toBe(358);
    expect(steTokens(body)).toBe(54);
  });

  test("skills/**/*.md totals 245 STE tokens", () => {
    const root = join(PLUGIN_ROOT, "skills");
    let total = 0;
    let files = 0;
    for (const rel of new Glob("**/*.md").scanSync(root)) {
      files += 1;
      total += steTokens(read(join(root, rel)));
    }
    expect(files).toBeGreaterThan(20);
    expect(total).toBe(245);
  });

  // Orchestrator fix (a test defect found in GREEN): the STE-557 guard forbids
  // any test asserting the live pin equals a literal. "Not raised by this FR"
  // is expressed against STE-605's own ledger entry instead: no entry names
  // this FR, the head is at or below STE-605's value, and it is measured.
  test("the reachability pin is not raised: no STE-606 entry, the head is at or below STE-605's, and measured", async () => {
    expect(ORDERED_UNREACHABLE_PIN_LEDGER.some((m) => m.rationale.includes("STE-606"))).toBe(false);
    const ste605 = ORDERED_UNREACHABLE_PIN_LEDGER.find((m) => m.rationale.includes("M_947c79/STE-605"));
    expect(ste605, "STE-605's ledger entry is missing").toBeDefined();
    const head = ORDERED_UNREACHABLE_PIN_LEDGER[0]!;
    expect(head.value).toBeLessThanOrEqual(ste605!.value);
    expect(ORDERED_UNREACHABLE_PIN).toBe(head.value);
    const report = await runModuleReachabilityProbe(REPO_ROOT);
    expect(report.orderedUnreachable).toBe(head.value);
  }, 120_000);
});

// ===========================================================================
// Stage C hardening (AUDIT advisories). Tracked-ness is read from the COMMITTED
// bytes, and a Linear ticket that carries no team cannot be proven this team's.
// ===========================================================================

describe("STE-606 hardening — committed bytes vouch, and an absent team refuses", () => {
  test("a tracked FR file edited on disk to bind a sibling's key does not vouch for it (control: the committed key stays owned)", async () => {
    await withSharedGitRoots((_fe, be) => {
      boundFr(be, "GB-41");
      commitAll(be, "legacy binding");
      const path = join(be, "specs", "frs", "GB-41.md");
      writeFileSync(path, readFileSync(path, "utf-8").replace(/GB-41/g, "GF-101"));
      expect(verdictOf(be, jiraTicket({ key: "GF-101", labels: [FE_TAG] }))).toBe("foreign-repo");
      expect(verdictOf(be, jiraTicket({ key: "GB-41", labels: [], project: "GB" }))).toBe("owned");
    });
  });

  test("a Linear ticket carrying no team refuses as foreign-project (control: the same ticket with this team is owned)", async () => {
    await withRoots((_fe, be) => {
      declareLinear(be, BE_TAG);
      gitInit(be);
      const noTeam = linearTicket({ key: "STE-990", labels: [BE_TAG] });
      delete (noTeam as Record<string, unknown>).team;
      expect(verdictOf(be, noTeam)).toBe("foreign-project");
      expect(verdictOf(be, linearTicket({ key: "STE-990", labels: [BE_TAG] }))).toBe("owned");
    });
  });
});

describe("STE-606 hardening — the batch read slices bytes, not characters", () => {
  test("a committed FR full of multibyte text does not shift the read of the files after it", async () => {
    await withSharedGitRoots((_fe, be) => {
      boundFr(be, "GB-40");
      const first = join(be, "specs", "frs", "GB-40.md");
      writeFileSync(first, `${readFileSync(first, "utf-8")}\nÉté — naïve façade ✓ 日本語 🚀\n`);
      boundFr(be, "GB-41");
      boundFr(be, "GB-42");
      commitAll(be, "multibyte bindings");
      for (const key of ["GB-40", "GB-41", "GB-42"]) {
        expect(verdictOf(be, jiraTicket({ key, labels: [], project: "GB" }))).toBe("owned");
      }
    });
  });
});
