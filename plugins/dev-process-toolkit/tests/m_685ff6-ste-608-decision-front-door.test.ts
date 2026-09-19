// STE-608 (M_685ff6) — the decision front door, spawned as a subprocess, and
// the reachability it buys (probe #81).
//
//   bun run adapters/_shared/src/resolve_milestone_identity.ts \
//     <projectRoot> <mode> <project> <listingFile> --title <title>
//   (or --join-key <key> in place of --title)
//
// prints, one per line: act=, via=, key=, milestoneId= (empty for create),
// listing=<n> rows, <c> closed excluded, gate=<sentence>, default=allowed|forbidden,
// and for a Jira join `labels=<JSON array>` | `labels=unchanged`; it writes
// exactly one `milestone-decision` receipt under <projectRoot> and prints its
// `dpt-receipt:` line.
//
// Listing files are the RAW MCP answers the session saved:
//   jira   — a `searchJiraIssuesUsingJql` page: { issues: [{ key, fields: { summary,
//            status: { name, statusCategory: { key } }, labels, issuetype: { name },
//            project: { key } } }], isLast }
//   linear — a `list_milestones` answer: { milestones: [{ id, name, ... }] }

import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { receiptsDir } from "../adapters/_shared/src/dpt_paths";
import {
  gradePinLedger,
  ORDERED_UNREACHABLE_PIN_LEDGER,
  runModuleReachabilityProbe,
} from "../adapters/_shared/src/module_reachability";
import { claudeMd } from "./_span_fixture";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src");
const FRONT_DOOR = join(SRC, "resolve_milestone_identity.ts");
const SESSION = "s-608-front-door";

const tempDirs: string[] = [];
afterAll(() => {
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempDir(label: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `dpt-608-${label}-`)));
  tempDirs.push(d);
  return d;
}

// ------------------------------------------------------------------ fixtures

type Shared = "shared" | "unshared";

function jiraRoot(shared: Shared, opts: { floor?: string } = {}): string {
  const root = tempDir("jira");
  if (shared === "shared") {
    claudeMd(root, { mode: "jira", project: "GF", defaultLabels: ["glacy-be"], repoTag: "glacy-be", minDptVersion: opts.floor ?? "2.87.0" });
  } else claudeMd(root, { mode: "jira", project: "GF" });
  return root;
}

function linearRoot(shared: Shared): string {
  const root = tempDir("linear");
  if (shared === "shared") {
    claudeMd(root, { mode: "linear", team: "STE", project: "DPT", defaultLabels: ["dpt-be"], repoTag: "dpt-be", minDptVersion: "2.87.0" });
  } else claudeMd(root, { mode: "linear", team: "STE", project: "DPT" });
  return root;
}

interface EpicOpts {
  status?: "new" | "indeterminate" | "done" | null;
  statusName?: string;
  labels?: string[] | null;
  type?: string | null;
  project?: string;
}

function epic(key: string, summary: string, o: EpicOpts = {}): Record<string, unknown> {
  const fields: Record<string, unknown> = { summary, project: { key: o.project ?? "GF" } };
  const status = o.status === undefined ? "indeterminate" : o.status;
  if (status !== null) fields.status = { name: o.statusName ?? (status === "done" ? "Done" : "In Progress"), statusCategory: { key: status } };
  if (o.labels !== null) fields.labels = o.labels ?? [];
  if (o.type !== null) fields.issuetype = { name: o.type ?? "Epic" };
  return { key, fields };
}

function writeListing(content: unknown, raw = false): string {
  const dir = tempDir("listing");
  const p = join(dir, "listing.json");
  writeFileSync(p, raw ? String(content) : JSON.stringify(content));
  return p;
}

const UUID_A = "550e8400-e29b-41d4-a716-446655440000";
const UUID_B = "7a1c3f00-0000-4000-8000-000000000001";

// ------------------------------------------------------------------- running

interface Run {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runDoor(args: string[], o: { cwd?: string; session?: string | null } = {}): Run {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  delete env.CLAUDE_PLUGIN_ROOT;
  delete env.CLAUDE_PROJECT_DIR;
  if (o.session === null) delete env.CLAUDE_CODE_SESSION_ID;
  else env.CLAUDE_CODE_SESSION_ID = o.session ?? SESSION;
  const p = Bun.spawnSync(["bun", "run", FRONT_DOOR, ...args], {
    cwd: o.cwd ?? tempDir("cwd"),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  return { exitCode: p.exitCode ?? -1, stdout: p.stdout.toString(), stderr: p.stderr.toString() };
}

function show(r: Run): string {
  return `exit=${r.exitCode}\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`;
}

function ok(r: Run): Map<string, string> {
  if (r.exitCode !== 0) throw new Error(`expected exit 0, got:\n${show(r)}`);
  const m = new Map<string, string>();
  for (const line of r.stdout.split("\n")) {
    if (line.startsWith("dpt-receipt: ")) {
      m.set("dpt-receipt", line.slice("dpt-receipt: ".length));
      continue;
    }
    const i = line.indexOf("=");
    if (i > 0) m.set(line.slice(0, i), line.slice(i + 1));
  }
  return m;
}

function receiptFiles(root: string, session = SESSION): string[] {
  const dir = receiptsDir(root, session);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => join(dir, f));
}

function expectRefusal(r: Run, root: string | null, ...needles: Array<string | RegExp>): void {
  if (r.exitCode !== 1) throw new Error(`expected exit 1 (refusal), got:\n${show(r)}`);
  expect(r.stdout).toBe("");
  expect(r.stderr).toMatch(/^Remedy:/m);
  expect(r.stderr).toMatch(/^Context:/m);
  for (const n of needles) {
    if (typeof n === "string") expect(r.stderr).toContain(n);
    else expect(r.stderr).toMatch(n);
  }
  if (root !== null) expect(receiptFiles(root)).toEqual([]);
}

// ===========================================================================
// AC-STE-608.5 — the front door
// ===========================================================================

describe("AC-STE-608.5 — the decision front door prints the decision and writes one receipt", () => {
  test("Jira create: the seven lines, one milestone-decision receipt carrying the listing's sha256 and row keys in order", () => {
    const root = jiraRoot("unshared");
    const listing = writeListing({
      issues: [epic("GF-84", "Other"), epic("GF-12", "Payouts", { status: "done" }), epic("GF-90", "Third")],
      isLast: true,
    });
    const out = ok(runDoor([root, "jira", "GF", listing, "--title", "Payouts"]));
    expect(out.get("act")).toBe("create");
    expect(out.has("via")).toBe(true);
    expect(out.has("key")).toBe(true);
    expect(out.get("milestoneId")).toBe("");
    expect(out.get("listing")).toBe("3 rows, 1 closed excluded");
    expect(out.get("gate")).toBeTruthy();
    expect(out.get("default")).toBe("allowed");

    const files = receiptFiles(root);
    expect(files.length).toBe(1);
    expect(out.get("dpt-receipt")?.split(/\s+/)[0]).toBe(files[0]);
    const receipt = JSON.parse(readFileSync(files[0]!, "utf-8")) as Record<string, unknown>;
    expect(receipt.kind).toBe("milestone-decision");
    expect(receipt.sessionId).toBe(SESSION);
    const all = JSON.stringify(receipt);
    expect(all).toContain('"Payouts"');
    expect([receipt.decision, (receipt.evidence as Record<string, unknown> | null)?.act]).toContain("create");
    const evidence = JSON.stringify(receipt.evidence);
    const sha = createHash("sha256").update(readFileSync(listing)).digest("hex");
    expect(evidence).toContain(sha);
    expect(evidence).toContain(JSON.stringify(["GF-84", "GF-12", "GF-90"]));
  });

  test("Jira join by key: act=join, via=key, key, milestoneId, receipt records the join key", () => {
    const root = jiraRoot("unshared");
    const listing = writeListing({ issues: [epic("GF-85", "M_GF_85 — Canonical renamed", { labels: ["team-x"] })], isLast: true });
    const out = ok(runDoor([root, "jira", "GF", listing, "--join-key", "GF-85"]));
    expect(out.get("act")).toBe("join");
    expect(out.get("via")).toBe("key");
    expect(out.get("key")).toBe("GF-85");
    expect(out.get("milestoneId")).toBe("M_GF_85");
    const files = receiptFiles(root);
    expect(files.length).toBe(1);
    const receipt = readFileSync(files[0]!, "utf-8");
    expect(receipt).toContain('"GF-85"');
    expect(receipt).toContain("join");
  });

  test("Linear: the closed rule is printed as not applicable, never as passed", () => {
    const root = linearRoot("unshared");
    const listing = writeListing({ milestones: [{ id: UUID_A, name: "Payouts" }, { id: UUID_B, name: "Other" }] });
    const out = ok(runDoor([root, "linear", "DPT", listing, "--title", "Payouts"]));
    expect(out.get("act")).toBe("join");
    expect(out.get("via")).toBe("title");
    expect(out.get("key")).toBe(UUID_A);
    expect(out.get("milestoneId")).toBe("M_550e84");
    const listingLine = out.get("listing") ?? "";
    expect(listingLine.startsWith("2 rows")).toBe(true);
    expect(listingLine).toMatch(/not applicable/i);
    expect(listingLine).not.toMatch(/0 closed excluded/);
  });

  test("an empty listing prints listing=0 rows and decides create — reported, never silent", () => {
    const root = linearRoot("unshared");
    const out = ok(runDoor([root, "linear", "DPT", writeListing({ milestones: [] }), "--title", "Payouts"]));
    expect(out.get("act")).toBe("create");
    expect((out.get("listing") ?? "").startsWith("0 rows")).toBe(true);
    expect(receiptFiles(root).length).toBe(1);
  });

  test("relocated: run from another repository's checkout, the receipt lands under <projectRoot> and nothing under cwd", () => {
    const root = jiraRoot("unshared");
    const elsewhere = tempDir("other-checkout");
    execFileSync("git", ["init", "-q", elsewhere]);
    const out = ok(runDoor([root, "jira", "GF", writeListing({ issues: [], isLast: true }), "--title", "Payouts"], { cwd: elsewhere }));
    expect(out.get("act")).toBe("create");
    expect(receiptFiles(root).length).toBe(1);
    expect(existsSync(join(elsewhere, ".dpt"))).toBe(false);
  });

  describe("refusals: exit 1, NFR-10 on stderr, empty stdout, no receipt", () => {
    const listingOk = () => writeListing({ issues: [], isLast: true });

    test("unreadable listing file", () => {
      const root = jiraRoot("unshared");
      expectRefusal(runDoor([root, "jira", "GF", join(tempDir("gone"), "missing.json"), "--title", "Payouts"]), root);
    });
    test("malformed JSON", () => {
      const root = jiraRoot("unshared");
      expectRefusal(runDoor([root, "jira", "GF", writeListing("{not json", true), "--title", "Payouts"]), root);
    });
    test("unrecognised listing shape", () => {
      const root = jiraRoot("unshared");
      expectRefusal(runDoor([root, "jira", "GF", writeListing({ foo: 1 }), "--title", "Payouts"]), root);
      const lin = linearRoot("unshared");
      expectRefusal(runDoor([lin, "linear", "DPT", writeListing({ issues: [], isLast: true }), "--title", "Payouts"]), lin);
    });
    test("a Jira page that is not the last page (isLast:false, or a nextPageToken)", () => {
      const root = jiraRoot("unshared");
      expectRefusal(runDoor([root, "jira", "GF", writeListing({ issues: [epic("GF-1", "A")], isLast: false }), "--title", "Payouts"]), root);
      expectRefusal(
        runDoor([root, "jira", "GF", writeListing({ issues: [epic("GF-1", "A")], isLast: true, nextPageToken: "abc" }), "--title", "Payouts"]),
        root,
      );
    });
    // Stage C hardening: a page that never SAYS it is the last one has not
    // proven the container absent (the same rule create_idempotency_probe
    // applies to this Jira search answer).
    test("a Jira page with no isLast, or a non-boolean one, is not proven the last page", () => {
      const root = jiraRoot("unshared");
      expectRefusal(runDoor([root, "jira", "GF", writeListing({ issues: [epic("GF-1", "A")] }), "--title", "Payouts"]), root, "isLast");
      expectRefusal(
        runDoor([root, "jira", "GF", writeListing({ issues: [epic("GF-1", "A")], isLast: "true" }), "--title", "Payouts"]),
        root,
        "isLast",
      );
    });
    test("unknown mode", () => {
      const root = jiraRoot("unshared");
      expectRefusal(runDoor([root, "none", "GF", listingOk(), "--title", "Payouts"]), root);
    });
    test("incomplete argv", () => {
      const root = jiraRoot("unshared");
      expectRefusal(runDoor([root, "jira", "GF", listingOk()]), root);
      expectRefusal(runDoor([root, "jira"]), root);
      expectRefusal(runDoor([root, "jira", "GF", listingOk(), "--title", "Payouts", "--join-key", "GF-85"]), root);
    });
    test("a Jira row keyed outside <project> refuses: not that project's Epic listing", () => {
      const root = jiraRoot("unshared");
      expectRefusal(runDoor([root, "jira", "GF", writeListing({ issues: [epic("NEX-9", "A", { project: "NEX" })], isLast: true }), "--title", "Payouts"]), root, "NEX-9");
    });
    test("a Jira row whose issue type is absent, or is not Epic, refuses", () => {
      const root = jiraRoot("unshared");
      expectRefusal(runDoor([root, "jira", "GF", writeListing({ issues: [epic("GF-9", "A", { type: null })], isLast: true }), "--title", "Payouts"]), root, "GF-9");
      expectRefusal(runDoor([root, "jira", "GF", writeListing({ issues: [epic("GF-9", "A", { type: "Task" })], isLast: true }), "--title", "Payouts"]), root, "GF-9");
    });
    test("an unreadable <projectRoot>/CLAUDE.md refuses with the reader's own text, never read as unshared", () => {
      const root = tempDir("unreadable-claude");
      mkdirSync(join(root, "CLAUDE.md"));
      expectRefusal(runDoor([root, "jira", "GF", listingOk(), "--title", "Payouts"]), root, /cannot be read/);
    });
    test("a declaration readWorkspaceBinding refuses (repo_tag without a floor) refuses with that text", () => {
      const root = tempDir("bad-declaration");
      claudeMd(root, { mode: "jira", project: "GF", defaultLabels: ["glacy-be"], repoTag: "glacy-be" });
      expectRefusal(runDoor([root, "jira", "GF", listingOk(), "--title", "Payouts"]), root, "WorkspaceBindingError", "min_dpt_version");
    });
    test("a declared min_dpt_version above the running version refuses with the floor check's text", () => {
      const root = jiraRoot("shared", { floor: "99.0.0" });
      expectRefusal(runDoor([root, "jira", "GF", listingOk(), "--title", "Payouts"]), root, "is below this workspace's min_dpt_version 99.0.0");
    });
  });
});

// ===========================================================================
// AC-STE-608.6 — the gate sentence names the act; default forbidden on a shared title join
// ===========================================================================

describe("AC-STE-608.6 — gate= names the act, default= follows the binding", () => {
  test("create: the sentence names the container kind, the title and the project", () => {
    const root = jiraRoot("unshared");
    const gate = ok(runDoor([root, "jira", "GF", writeListing({ issues: [], isLast: true }), "--title", "Waiting States II"])).get("gate") ?? "";
    expect(gate).toContain("Epic");
    expect(gate).toContain("Waiting States II");
    expect(gate).toContain("GF");
    expect(gate).toMatch(/creat/i);
  });

  test("join: the sentence names the key, its current title and status, and that nothing is created", () => {
    const root = jiraRoot("unshared");
    const listing = writeListing({ issues: [epic("GF-85", "Payouts renamed", { statusName: "In Progress", labels: [] })], isLast: true });
    const gate = ok(runDoor([root, "jira", "GF", listing, "--join-key", "GF-85"])).get("gate") ?? "";
    expect(gate).toContain("GF-85");
    expect(gate).toContain("Payouts renamed");
    expect(gate).toContain("In Progress");
    expect(gate).toMatch(/nothing is created/i);
  });

  test("shared title-join forbidden; unshared title-join allowed; shared create allowed", () => {
    const joinable = () => writeListing({ issues: [epic("GF-85", "Payouts", { labels: [] })], isLast: true });
    // Amended by AC-STE-610.4: a shared join now names its sibling. Without
    // `--sibling` it refuses before any default is printed; the forbidden
    // default itself stays graded in process (milestoneAllocationGateSpec) and,
    // with `--sibling`, in the STE-610 join-sibling suite.
    const shared = jiraRoot("shared");
    expectRefusal(runDoor([shared, "jira", "GF", joinable(), "--title", "Payouts"]), shared, "--sibling");

    const unshared = jiraRoot("unshared");
    const unsharedJoin = ok(runDoor([unshared, "jira", "GF", joinable(), "--title", "Payouts"]));
    expect(unsharedJoin.get("act")).toBe("join");
    expect(unsharedJoin.get("default")).toBe("allowed");

    const sharedCreate = ok(runDoor([jiraRoot("shared"), "jira", "GF", writeListing({ issues: [], isLast: true }), "--title", "Payouts"]));
    expect(sharedCreate.get("act")).toBe("create");
    expect(sharedCreate.get("default")).toBe("allowed");

    const sharedLinear = linearRoot("shared");
    expectRefusal(runDoor([sharedLinear, "linear", "DPT", writeListing({ milestones: [{ id: UUID_A, name: "Payouts" }] }), "--title", "Payouts"]), sharedLinear, "--sibling");
  });
});

// ===========================================================================
// AC-STE-608.8 / .9 — printed outcome and label lines
// ===========================================================================

describe("AC-STE-608.9 — the Jira label value is computed", () => {
  test('a join onto an Epic listed with ["team-x"] prints labels=["team-x","milestone-M_GF_85"]', () => {
    const root = jiraRoot("unshared");
    const listing = writeListing({ issues: [epic("GF-85", "Payouts", { labels: ["team-x"] })], isLast: true });
    expect(ok(runDoor([root, "jira", "GF", listing, "--join-key", "GF-85"])).get("labels")).toBe('["team-x","milestone-M_GF_85"]');
  });

  test("original order is kept", () => {
    const root = jiraRoot("unshared");
    const listing = writeListing({ issues: [epic("GF-85", "Payouts", { labels: ["zeta", "alpha"] })], isLast: true });
    expect(ok(runDoor([root, "jira", "GF", listing, "--title", "Payouts"])).get("labels")).toBe('["zeta","alpha","milestone-M_GF_85"]');
  });

  test("labels=unchanged when the milestone label is already present", () => {
    const root = jiraRoot("unshared");
    const listing = writeListing({ issues: [epic("GF-85", "Payouts", { labels: ["team-x", "milestone-M_GF_85"] })], isLast: true });
    expect(ok(runDoor([root, "jira", "GF", listing, "--join-key", "GF-85"])).get("labels")).toBe("unchanged");
  });

  test("a joined row whose listing carries no labels field refuses", () => {
    const root = jiraRoot("unshared");
    const listing = writeListing({ issues: [epic("GF-85", "Payouts", { labels: null })], isLast: true });
    expectRefusal(runDoor([root, "jira", "GF", listing, "--join-key", "GF-85"]), root, "GF-85", /label/i);
  });

  test("the Epic mint front door prints the create's labels from an empty set, and outcome=created", () => {
    const p = Bun.spawnSync(["bun", "run", join(SRC, "mint_milestone_epic.ts"), "GF", "Waiting States II", "GF-78"], { stdout: "pipe", stderr: "pipe" });
    expect(p.exitCode).toBe(0);
    const lines = p.stdout.toString().split("\n");
    expect(lines).toContain('labels=["milestone-M_GF_78"]');
    expect(lines).toContain("outcome=created");
  });

  test("the Linear mint front door prints outcome=created", () => {
    const p = Bun.spawnSync(["bun", "run", join(SRC, "mint_milestone_linear.ts"), "DPT", "Payouts", UUID_A], { stdout: "pipe", stderr: "pipe" });
    expect(p.exitCode).toBe(0);
    expect(p.stdout.toString().split("\n")).toContain("outcome=created");
  });
});

// ===========================================================================
// AC-STE-608.12 — reachability
// ===========================================================================

/** Measured at 2c99778 (the branch base): the live count, and the ordered-unreachable references to the front door's module. */
const BASELINE_LIVE = 122;
const BASELINE_FRONT_DOOR_REFS = 1;

describe("AC-STE-608.12 — the front door makes resolve_milestone_identity.ts reachable", () => {
  test("no ordered reference to resolve_milestone_identity.ts is unreachable, and the live count falls by exactly those references", async () => {
    const report = await runModuleReachabilityProbe(REPO_ROOT);
    const stranded = report.records.filter(
      (r) => r.module.endsWith("resolve_milestone_identity.ts") && r.refClass === "ordered" && !r.reachable,
    );
    expect(stranded).toEqual([]);
    expect(report.orderedUnreachable).toBe(BASELINE_LIVE - BASELINE_FRONT_DOOR_REFS);
  }, 60_000);

  test("the ledger gains one lowering entry to the live count, and gradePinLedger returns ok", async () => {
    const head = ORDERED_UNREACHABLE_PIN_LEDGER[0]!;
    expect(head.value).toBe(BASELINE_LIVE - BASELINE_FRONT_DOOR_REFS);
    expect(ORDERED_UNREACHABLE_PIN_LEDGER[1]!.value).toBe(BASELINE_LIVE);
    expect(head.rationale).toContain("resolve_milestone_identity.ts");
    expect(head.commit.trim()).not.toBe("");
    expect(gradePinLedger(ORDERED_UNREACHABLE_PIN_LEDGER)).toEqual({ ok: true, refusals: [] });
  });

  test("(control) no capability key is added: closing_summary_capability_keys.ts is byte-unchanged from the branch base", () => {
    const rel = "plugins/dev-process-toolkit/adapters/_shared/src/closing_summary_capability_keys.ts";
    const base = execFileSync("git", ["-C", REPO_ROOT, "merge-base", "HEAD", "main"]).toString().trim();
    const atBase = execFileSync("git", ["-C", REPO_ROOT, "show", `${base}:${rel}`]);
    expect(Buffer.compare(readFileSync(join(REPO_ROOT, rel)), atBase)).toBe(0);
  });
});
