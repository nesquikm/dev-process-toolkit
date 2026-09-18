// STE-605 (M_947c79) — the orphan list offers only this repository's tickets
// and names who filed the rest.
//
// Every behavioural leg SPAWNS the front doors of
// `adapters/_shared/src/container_ownership.ts` (`list`, `consent`) over real
// fixture roots (`makeSpanFixture`: `a` = FE, `b` = BE) and saved two-repo
// pages for both trackers. The output framing these legs read is fixed in
// `tests/_orphan_pages.ts`.
//
// The AC.2 control runs the PRE-CHANGE `reconcileTrackerLocal`, extracted with
// `git show ac1f3cb:...` (plus its imports), over the same tickets.
//
// Filter by AC with `bun test -t "AC-STE-605.N"`.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CANONICAL_CAPABILITY_KEYS } from "../adapters/_shared/src/closing_summary_capability_keys";
import { importFromTracker } from "../adapters/_shared/src/import";
import {
  ORDERED_UNREACHABLE_PIN,
  ORDERED_UNREACHABLE_PIN_LEDGER,
  runModuleReachabilityProbe,
} from "../adapters/_shared/src/module_reachability";
import type { AdapterDriver, UpsertMetadataInput } from "../adapters/_shared/src/tracker_provider";
import { TrackerProvider } from "../adapters/_shared/src/tracker_provider";
import { RECEIPT_ANNOUNCEMENT_PREFIX,
  parseReceiptAnnouncement, readSessionReceipts } from "../adapters/_shared/src/tracker_receipts";
import {
  BE_TAG,
  BE_TICKETS,
  boundFr,
  classes,
  declareJira,
  declareLinear,
  DRIFT_MODULE,
  EPICS,
  FE_TAG,
  FE_TICKETS,
  HAND_FILED,
  HAND_TAGGED_BE,
  jiraIssue,
  jiraPage,
  keysOf,
  keysOfClass,
  linearPage,
  offered,
  OLD_CLIENT,
  OWNERSHIP_MODULE,
  PLUGIN_ROOT,
  probeRowKeys,
  REPO_ROOT,
  type Run,
  snapshotTree,
  spawnModule,
  summary,
  tableRows,
  type Ticket,
  TWO_REPO,
} from "./_orphan_pages";
import { makeSpanFixture, pluginManifest } from "./_span_fixture";

const PRE_CHANGE_SHA = "ac1f3cb";
const RECONCILE_REL = "plugins/dev-process-toolkit/adapters/_shared/src/reconcile_tracker_local.ts";
const SESSION = `ste605-${process.pid}`;

let manifestDir = "";
let scratch = "";

beforeAll(() => {
  manifestDir = mkdtempSync(join(tmpdir(), "dpt-ste605-manifest-"));
  pluginManifest(manifestDir, "2.87.0");
  scratch = mkdtempSync(join(tmpdir(), "dpt-ste605-pages-"));
});

afterAll(() => {
  rmSync(manifestDir, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

const env = () => ({ CLAUDE_PLUGIN_ROOT: manifestDir, CLAUDE_CODE_SESSION_ID: SESSION });

let pageSeq = 0;
function writePage(page: unknown): string {
  pageSeq += 1;
  const p = join(scratch, `page-${pageSeq}.json`);
  writeFileSync(p, typeof page === "string" ? page : JSON.stringify(page));
  return p;
}

const list = (root: string, pages: string[]): Run =>
  spawnModule(OWNERSHIP_MODULE, ["list", root, ...pages], env());
const consent = (root: string, key: string, pages: string[]): Run =>
  spawnModule(OWNERSHIP_MODULE, ["consent", root, key, ...pages], env());
const probe = (root: string, pages: string[]): Run => spawnModule(DRIFT_MODULE, [root, ...pages], env());

function okList(run: Run): Run {
  expect(run.code, `list failed\nstdout=${run.stdout}\nstderr=${run.stderr}`).toBe(0);
  expect(tableRows(run.stdout).length, `no table rows\n${run.stdout}`).toBeGreaterThan(0);
  return run;
}

function withRoots<T>(body: (fe: string, be: string) => T | Promise<T>): Promise<T> {
  const fx = makeSpanFixture("M_GF_85");
  return Promise.resolve()
    .then(() => body(fx.a, fx.b))
    .finally(() => fx.cleanup());
}

const sorted = (xs: string[]) => [...xs].sort();

// ===========================================================================
// AC-STE-605.1 — one classifier: ours / sibling / unowned / container.
// ===========================================================================

describe("AC-STE-605.1 — classification over a two-repo Jira page", () => {
  test("FE: ours = FE's, sibling = BE's + the hand-tagged glacy-be ticket, unowned = hand-filed + back-linked unlabelled, container = the Epics", async () => {
    await withRoots((fe) => {
      declareJira(fe, FE_TAG);
      const out = okList(list(fe, [writePage(jiraPage(TWO_REPO))])).stdout;
      expect(keysOfClass(out, "ours")).toEqual(sorted(keysOf(FE_TICKETS)));
      expect(keysOfClass(out, "sibling")).toEqual(sorted([...keysOf(BE_TICKETS), HAND_TAGGED_BE.key]));
      expect(keysOfClass(out, "unowned")).toEqual(sorted([...keysOf(HAND_FILED), OLD_CLIENT.key]));
      expect(keysOfClass(out, "container")).toEqual(sorted(keysOf(EPICS)));
    });
  });

  test("BE: the mirror, except that the hand-tagged ticket is BE's ours", async () => {
    await withRoots((_fe, be) => {
      declareJira(be, BE_TAG);
      const out = okList(list(be, [writePage(jiraPage(TWO_REPO))])).stdout;
      expect(keysOfClass(out, "ours")).toEqual(sorted([...keysOf(BE_TICKETS), HAND_TAGGED_BE.key]));
      expect(keysOfClass(out, "sibling")).toEqual(sorted(keysOf(FE_TICKETS)));
      expect(keysOfClass(out, "unowned")).toEqual(sorted([...keysOf(HAND_FILED), OLD_CLIENT.key]));
      expect(keysOfClass(out, "container")).toEqual(sorted(keysOf(EPICS)));
    });
  });

  test("CONTROL (back-link is not ownership): the back-linked unlabelled ticket is unowned for BOTH repositories, never sibling", async () => {
    await withRoots((fe, be) => {
      declareJira(fe, FE_TAG);
      declareJira(be, BE_TAG);
      const page = writePage(jiraPage(TWO_REPO));
      for (const root of [fe, be]) {
        const cls = classes(okList(list(root, [page])).stdout);
        expect(cls.get(OLD_CLIENT.key)).toBe("unowned");
      }
    });
  });

  test("the back-link is reported as a toolkit-written column, not as a class", async () => {
    await withRoots((fe) => {
      declareJira(fe, FE_TAG);
      const rows = tableRows(okList(list(fe, [writePage(jiraPage(TWO_REPO))])).stdout);
      const old = rows.find((r) => r.key === OLD_CLIENT.key)!;
      const hand = rows.find((r) => r.key === HAND_FILED[0]!.key)!;
      expect(old.cells[3]).not.toBe(hand.cells[3]);
    });
  });

  test("Linear: the container class is empty — Linear milestones are not issues", async () => {
    await withRoots((fe) => {
      declareLinear(fe, FE_TAG);
      const tickets: Ticket[] = [
        { key: "STE-901", title: "FE one", labels: [FE_TAG], creator: "Fe Dev", backLink: true },
        { key: "STE-902", title: "BE one", labels: [BE_TAG], creator: "Be Dev", backLink: true },
        { key: "STE-903", title: "Hand filed", labels: [], creator: "Pat Manager" },
      ];
      const out = okList(list(fe, [writePage(linearPage(tickets))])).stdout;
      expect(keysOfClass(out, "ours")).toEqual(["STE-901"]);
      expect(keysOfClass(out, "sibling")).toEqual(["STE-902"]);
      expect(keysOfClass(out, "unowned")).toEqual(["STE-903"]);
      expect(keysOfClass(out, "container")).toEqual([]);
      expect(summary(out)?.counts.containers).toBe(0);
    });
  });
});

// ===========================================================================
// AC-STE-605.2 — the listing forbids; control: the pre-change reconcile offers all.
// ===========================================================================

function extractAt(sha: string, repoRelPath: string, dest: string, seen = new Set<string>()): string {
  const out = join(dest, repoRelPath);
  if (seen.has(repoRelPath)) return out;
  seen.add(repoRelPath);
  const proc = Bun.spawnSync(["git", "show", `${sha}:${repoRelPath}`], { cwd: REPO_ROOT });
  if (proc.exitCode !== 0) throw new Error(`git show ${sha}:${repoRelPath} failed: ${proc.stderr.toString()}`);
  const body = proc.stdout.toString();
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, body);
  for (const m of body.matchAll(/from\s+"(\.{1,2}\/[^"]+)"/g)) {
    let dep = join(dirname(repoRelPath), m[1]!);
    if (!dep.endsWith(".ts")) dep += ".ts";
    extractAt(sha, dep, dest, seen);
  }
  return out;
}

describe("AC-STE-605.2 — the listing never offers a sibling's ticket or a container", () => {
  test("FE's list offers zero BE tickets and zero Epics", async () => {
    await withRoots((fe) => {
      declareJira(fe, FE_TAG);
      const offers = offered(okList(list(fe, [writePage(jiraPage(TWO_REPO))])).stdout);
      expect(offers.length).toBeGreaterThan(0);
      for (const k of [...keysOf(BE_TICKETS), HAND_TAGGED_BE.key, ...keysOf(EPICS)]) {
        expect(offers).not.toContain(k);
      }
    });
  });

  test("BE's list offers zero FE tickets and zero Epics", async () => {
    await withRoots((_fe, be) => {
      declareJira(be, BE_TAG);
      const offers = offered(okList(list(be, [writePage(jiraPage(TWO_REPO))])).stdout);
      expect(offers.length).toBeGreaterThan(0);
      for (const k of [...keysOf(FE_TICKETS), ...keysOf(EPICS)]) expect(offers).not.toContain(k);
    });
  });

  test("CONTROL: the pre-change reconcileTrackerLocal over the same tickets offers all of them", async () => {
    const oldDir = mkdtempSync(join(tmpdir(), "dpt-ste605-old-"));
    try {
      const old = await import(extractAt(PRE_CHANGE_SHA, RECONCILE_REL, oldDir));
      await withRoots(async (fe) => {
        declareJira(fe, FE_TAG);
        // The observed live emulation: `project = GF AND statusCategory != Done`.
        const provider = {
          mode: "tracker" as const,
          listActiveFRs: async () => keysOf(TWO_REPO),
          listMilestones: async () => [],
        };
        const r = await old.reconcileTrackerLocal(provider, join(fe, "specs"));
        const orphanIds = r.trackerOrphans.map((i: { id: string }) => i.id).sort();
        for (const k of [...keysOf(BE_TICKETS), ...keysOf(EPICS)]) expect(orphanIds).toContain(k);
      });
    } finally {
      rmSync(oldDir, { recursive: true, force: true });
    }
  });
});

// ===========================================================================
// AC-STE-605.3 — the listing permits, names owners, and counts every class.
// ===========================================================================

describe("AC-STE-605.3 — ours and unowned are offered with their creator", () => {
  test("an unbound ours ticket and each unowned ticket are offered, each owned by its creator", async () => {
    await withRoots((fe) => {
      declareJira(fe, FE_TAG);
      boundFr(fe, "GF-101");
      const out = okList(list(fe, [writePage(jiraPage(TWO_REPO))])).stdout;
      const offers = offered(out);
      expect(offers).toEqual(sorted(["GF-102", ...keysOf(HAND_FILED), OLD_CLIENT.key]));
      expect(offers).not.toContain("GF-101"); // bound here
      for (const k of offers) expect(out).toContain(`Skip ${k}`);
      const rows = new Map(tableRows(out).map((r) => [r.key, r]));
      expect(rows.get("GF-102")?.owner).toBe("Fe Dev");
      expect(rows.get("GF-121")?.owner).toBe("Pat Manager");
      expect(rows.get("GF-122")?.owner).toBe("Quinn Support");
      expect(rows.get("GF-131")?.owner).toBe("Old Client");
    });
  });

  test("the summary line counts every class, the excluded ones included, and says the page set was complete", async () => {
    await withRoots((fe) => {
      declareJira(fe, FE_TAG);
      boundFr(fe, "GF-101");
      const s = summary(okList(list(fe, [writePage(jiraPage(TWO_REPO))])).stdout);
      expect(s, "no `summary:` line").not.toBeNull();
      expect(s!.counts).toEqual({ read: 10, ours: 1, sibling: 3, unowned: 3, containers: 2, bound: 1 });
      expect(s!.line).toMatch(/excluded/);
      expect(s!.complete).toBe(true);
    });
  });

  test("an incomplete page set says so on the summary line", async () => {
    await withRoots((fe) => {
      declareJira(fe, FE_TAG);
      const s = summary(okList(list(fe, [writePage(jiraPage(TWO_REPO, false))])).stdout);
      expect(s?.complete).toBe(false);
    });
  });

  test("undeclared: only containers are removed — every other ticket is offered", async () => {
    await withRoots((fe) => {
      declareJira(fe, null);
      const offers = offered(okList(list(fe, [writePage(jiraPage(TWO_REPO))])).stdout);
      expect(offers).toEqual(sorted(keysOf(TWO_REPO.filter((t) => t.type !== "Epic"))));
    });
  });
});

// ===========================================================================
// AC-STE-605.4 — consent writes an import receipt for ours and unowned only.
// ===========================================================================

describe("AC-STE-605.4 — consent", () => {
  const receiptLines = (run: Run) =>
    run.stdout
      .split("\n")
      .filter((l) => l.startsWith(RECEIPT_ANNOUNCEMENT_PREFIX))
      .map((l) => parseReceiptAnnouncement(l)!.path);

  for (const key of ["GF-102", "GF-121"]) {
    test(`shared: ${key} (${key === "GF-102" ? "ours" : "unowned"}) gets an import receipt naming it`, async () => {
      await withRoots((fe) => {
        declareJira(fe, FE_TAG);
        const run = consent(fe, key, [writePage(jiraPage(TWO_REPO))]);
        expect(run.code, run.stderr).toBe(0);
        const paths = receiptLines(run);
        expect(paths.length).toBe(1);
        expect(existsSync(paths[0]!)).toBe(true);
        const { receipts } = readSessionReceipts(fe, SESSION);
        expect(receipts.length).toBe(1);
        expect(receipts[0]!.kind).toBe("import");
        expect(receipts[0]!.subject).toBe(key);
      });
    });
  }

  for (const [key, why] of [
    ["GF-111", "sibling"],
    ["GF-141", "hand-tagged sibling"],
    ["GF-85", "container"],
    ["GF-999", "absent from the pages"],
  ] as const) {
    test(`shared: ${key} (${why}) is refused with zero files written`, async () => {
      await withRoots((fe) => {
        declareJira(fe, FE_TAG);
        const page = writePage(jiraPage(TWO_REPO));
        const before = snapshotTree(fe);
        const run = consent(fe, key, [page]);
        expect(run.code).not.toBe(0);
        expect(receiptLines(run)).toEqual([]);
        expect(snapshotTree(fe)).toEqual(before);
      });
    });
  }

  test("undeclared: consent is accepted and no receipt is written", async () => {
    await withRoots((fe) => {
      declareJira(fe, null);
      const page = writePage(jiraPage(TWO_REPO));
      const before = snapshotTree(fe);
      const run = consent(fe, "GF-102", [page]);
      expect(run.code, run.stderr).toBe(0);
      expect(receiptLines(run)).toEqual([]);
      expect(snapshotTree(fe)).toEqual(before);
    });
  });
});

// ===========================================================================
// AC-STE-605.5 — importing an unowned ticket claims it.
// ===========================================================================

interface MemTicket extends Ticket {
  description: string;
}

class RecordingJiraDriver implements AdapterDriver {
  readonly trackerKey = "jira";
  writes: { op: string; ticketId: string | null; meta?: UpsertMetadataInput }[] = [];
  constructor(readonly store: Map<string, MemTicket>) {}
  async pullAcs(): Promise<unknown[]> {
    return [];
  }
  async pushAcToggle(ticketId: string): Promise<void> {
    this.writes.push({ op: "pushAcToggle", ticketId });
  }
  async transitionStatus(ticketId: string): Promise<void> {
    this.writes.push({ op: "transitionStatus", ticketId });
  }
  async upsertTicketMetadata(ticketId: string | null, meta: UpsertMetadataInput): Promise<string> {
    this.writes.push({ op: "upsertTicketMetadata", ticketId, meta });
    const t = ticketId === null ? undefined : this.store.get(ticketId);
    if (t) {
      if (meta.description !== undefined) t.description = meta.description;
      if (meta.labels !== undefined) t.labels = [...meta.labels];
    }
    return ticketId ?? "GF-NEW";
  }
  async getTicketStatus() {
    return { status: "backlog" as const, assignee: null };
  }
  getUrl(id: string): string {
    return `https://example.atlassian.net/browse/${id}`;
  }
}

function memStore(tickets: Ticket[]): Map<string, MemTicket> {
  return new Map(tickets.map((t) => [t.key, { ...t, labels: [...t.labels], description: "" }]));
}

function pageFromStore(store: Map<string, MemTicket>) {
  return {
    issues: [...store.values()].map((t) => jiraIssue(t)).map((row, i) => {
      const t = [...store.values()][i]!;
      if (t.description) (row.fields as Record<string, unknown>).description = t.description;
      return row;
    }),
    isLast: true,
  };
}

function providerFor(driver: AdapterDriver) {
  return new TrackerProvider({
    driver,
    currentUser: "fe-dev",
    resolveTrackerRef: async (s: string) => s.replace(/^jira:/, ""),
  });
}

/** An unowned ticket carrying a milestone label the claim must not drop. */
const UNOWNED_WITH_LABEL: Ticket = {
  key: "GF-124",
  title: "Hand-filed under the Epic",
  labels: ["milestone-M_GF_85"],
  creator: "Pat Manager",
};

describe("AC-STE-605.5 — importing an unowned ticket claims it", () => {
  test("the outward write set is exactly the description sync plus the tag (labels merged, none dropped)", async () => {
    await withRoots(async (fe) => {
      declareJira(fe, FE_TAG);
      const store = memStore([...TWO_REPO, UNOWNED_WITH_LABEL]);
      const driver = new RecordingJiraDriver(store);
      const pages = [pageFromStore(store)];
      await importFromTracker("jira", "GF-124", providerFor(driver), join(fe, "specs"), async () => "M_GF_85", {
        projectRoot: fe,
        pages,
      } as never);
      expect(driver.writes.length).toBeGreaterThan(0);
      for (const w of driver.writes) {
        expect(w.op).toBe("upsertTicketMetadata");
        expect(w.ticketId).toBe("GF-124");
      }
      const fields = new Set(driver.writes.flatMap((w) => Object.keys(w.meta ?? {})));
      for (const f of fields) expect(["title", "description", "labels"]).toContain(f);
      expect(fields.has("description")).toBe(true);
      expect(fields.has("labels")).toBe(true);
      expect(sorted(store.get("GF-124")!.labels)).toEqual(sorted(["milestone-M_GF_85", FE_TAG]));
      expect(existsSync(join(fe, "specs", "frs", "GF-124.md"))).toBe(true);
    });
  });

  test("re-listing from the sibling then classifies the claimed ticket sibling", async () => {
    await withRoots(async (fe, be) => {
      declareJira(fe, FE_TAG);
      declareJira(be, BE_TAG);
      const store = memStore([...TWO_REPO, UNOWNED_WITH_LABEL]);
      const beBefore = classes(okList(list(be, [writePage(pageFromStore(store))])).stdout);
      expect(beBefore.get("GF-124")).toBe("unowned");
      const driver = new RecordingJiraDriver(store);
      await importFromTracker("jira", "GF-124", providerFor(driver), join(fe, "specs"), async () => "M_GF_85", {
        projectRoot: fe,
        pages: [pageFromStore(store)],
      } as never);
      const beAfter = classes(okList(list(be, [writePage(pageFromStore(store))])).stdout);
      expect(beAfter.get("GF-124")).toBe("sibling");
    });
  });

  for (const [key, why] of [
    ["GF-111", "sibling"],
    ["GF-85", "container"],
  ] as const) {
    test(`a ${why} key handed to the import path refuses before any write`, async () => {
      await withRoots(async (fe) => {
        declareJira(fe, FE_TAG);
        const store = memStore(TWO_REPO);
        const driver = new RecordingJiraDriver(store);
        const before = snapshotTree(fe);
        await expect(
          importFromTracker("jira", key, providerFor(driver), join(fe, "specs"), async () => "M_GF_85", {
            projectRoot: fe,
            pages: [pageFromStore(store)],
          } as never),
        ).rejects.toThrow();
        expect(driver.writes).toEqual([]);
        expect(snapshotTree(fe)).toEqual(before);
      });
    });
  }

  test("BACKSTOP: an import whose tag write was skipped leaves a bound, untagged ticket that probe #49 reports as bound-ticket-untagged", async () => {
    await withRoots((fe) => {
      declareJira(fe, FE_TAG);
      boundFr(fe, "GF-122"); // imported, but the tag never landed
      const run = probe(fe, [writePage(jiraPage(TWO_REPO))]);
      expect(run.stdout, run.stderr).toMatch(/excluded/);
      expect(probeRowKeys(run.stdout, "bound-ticket-untagged")).toEqual(["GF-122"]);
    });
  });
});

// ===========================================================================
// AC-STE-605.8 — unreadable input refuses; nothing is listed.
// ===========================================================================

describe("AC-STE-605.8 — unreadable input", () => {
  function expectRefusal(run: Run, names: string): void {
    expect(run.code).not.toBe(0);
    expect(run.stderr).toContain(names);
    expect(tableRows(run.stdout)).toEqual([]);
    expect(offered(run.stdout)).toEqual([]);
  }

  test("a missing page file refuses naming the file", async () => {
    await withRoots((fe) => {
      declareJira(fe, FE_TAG);
      const missing = join(scratch, "no-such-page.json");
      expectRefusal(list(fe, [writePage(jiraPage(TWO_REPO)), missing]), missing);
    });
  });

  test("a non-JSON page refuses naming the file", async () => {
    await withRoots((fe) => {
      declareJira(fe, FE_TAG);
      const bad = writePage("{ this is not json");
      expectRefusal(list(fe, [writePage(jiraPage(TWO_REPO)), bad]), bad);
    });
  });

  test("a shared-mode ticket lacking `labels` refuses naming the key", async () => {
    await withRoots((fe) => {
      declareJira(fe, FE_TAG);
      const page = jiraPage(TWO_REPO);
      delete ((page.issues[3] as { fields: Record<string, unknown> }).fields).labels;
      expectRefusal(list(fe, [writePage(page)]), TWO_REPO[3]!.key);
    });
  });

  test("a shared-mode ticket lacking `description` refuses naming the key", async () => {
    await withRoots((fe) => {
      declareJira(fe, FE_TAG);
      const page = jiraPage(TWO_REPO);
      delete ((page.issues[5] as { fields: Record<string, unknown> }).fields).description;
      expectRefusal(list(fe, [writePage(page)]), TWO_REPO[5]!.key);
    });
  });

  test("CONTROL: the same label-less ticket lists in an undeclared repository", async () => {
    await withRoots((fe) => {
      declareJira(fe, null);
      const page = jiraPage(TWO_REPO);
      delete ((page.issues[3] as { fields: Record<string, unknown> }).fields).labels;
      const out = okList(list(fe, [writePage(page)])).stdout;
      expect(offered(out)).toContain(TWO_REPO[3]!.key);
    });
  });
});

// ===========================================================================
// AC-STE-605.9 — relocated: bindings are read only from the root given.
// ===========================================================================

describe("AC-STE-605.9 — two checkouts over one page", () => {
  test("the worktree that binds GF-101 reports it bound; the main checkout without the file reports it orphaned", async () => {
    await withRoots((main, worktree) => {
      declareJira(main, FE_TAG);
      declareJira(worktree, FE_TAG);
      boundFr(worktree, "GF-101");
      const page = writePage(jiraPage(TWO_REPO));
      const wt = okList(list(worktree, [page])).stdout;
      const mn = okList(list(main, [page])).stdout;
      expect(offered(wt)).not.toContain("GF-101");
      expect(summary(wt)?.counts.bound).toBe(1);
      expect(offered(mn)).toContain("GF-101");
      expect(summary(mn)?.counts.bound).toBe(0);
    });
  });
});

// ===========================================================================
// AC-STE-605.10 — old clients: the forwarding client's ticket, both sides.
// ===========================================================================

describe("AC-STE-605.10 — a pre-tagging client that forwards its own default labels", () => {
  const FORWARDED: Ticket = {
    key: "GF-151",
    title: "Old BE client ticket",
    labels: ["backend"],
    creator: "Old Be Client",
    backLink: true,
  };

  test("FE classifies it sibling; BE (whose defaults carry `backend`) classifies it unowned", async () => {
    await withRoots((fe, be) => {
      declareJira(fe, FE_TAG);
      declareJira(be, BE_TAG, ["backend"]);
      const page = writePage(jiraPage([...TWO_REPO, FORWARDED]));
      expect(classes(okList(list(fe, [page])).stdout).get("GF-151")).toBe("sibling");
      expect(classes(okList(list(be, [page])).stdout).get("GF-151")).toBe("unowned");
    });
  });

  test("probe #49: an unowned-container-ticket row in BE only", async () => {
    await withRoots((fe, be) => {
      declareJira(fe, FE_TAG);
      declareJira(be, BE_TAG, ["backend"]);
      const page = writePage(jiraPage([...TWO_REPO, FORWARDED]));
      const beRun = probe(be, [page]);
      const feRun = probe(fe, [page]);
      expect(beRun.stdout, beRun.stderr).toMatch(/excluded/);
      expect(feRun.stdout, feRun.stderr).toMatch(/excluded/);
      expect(probeRowKeys(beRun.stdout, "unowned-container-ticket")).toContain("GF-151");
      expect(probeRowKeys(feRun.stdout, "unowned-container-ticket")).not.toContain("GF-151");
    });
  });
});

// ===========================================================================
// AC-STE-605.11 — surfaces and budgets.
// ===========================================================================

describe("AC-STE-605.11 — surfaces and budgets", () => {
  const read = (p: string) => readFileSync(p, "utf-8");
  const steTokens = (s: string) => (s.match(/STE-\d+/g) ?? []).length;
  const MODULE_PATH_RE = /[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]*\.ts\b/;
  const SPEC_WRITE = join(PLUGIN_ROOT, "skills", "spec-write", "SKILL.md");
  const GATE_CHECK = join(PLUGIN_ROOT, "skills", "gate-check", "SKILL.md");
  const TRACKER_MODE_DOC = join(PLUGIN_ROOT, "docs", "spec-write-tracker-mode.md");

  const opRow = (doc: string) =>
    read(doc)
      .split("\n")
      .find((l) => l.startsWith("|") && l.includes("`list_active_frs`"));

  test("adapters/jira.md defines list_active_frs: the JQL, the required fields, paginated to isLast", () => {
    const row = opRow(join(PLUGIN_ROOT, "adapters", "jira.md"));
    expect(row, "no `list_active_frs` operation row in jira.md").toBeDefined();
    expect(row!).toContain("statusCategory != Done");
    expect(row!).toContain("searchJiraIssuesUsingJql");
    for (const f of ["labels", "issuetype", "creator", "description"]) expect(row!).toContain(f);
    expect(row!).toContain("isLast");
    expect(read(join(PLUGIN_ROOT, "adapters", "jira.md"))).toContain("container_ownership.ts");
  });

  test("adapters/linear.md defines list_active_frs: list_issues with createdBy, limit 250, cursor to hasNextPage: false", () => {
    const row = opRow(join(PLUGIN_ROOT, "adapters", "linear.md"));
    expect(row, "no `list_active_frs` operation row in linear.md").toBeDefined();
    expect(row!).toContain("list_issues");
    for (const f of ["labels", "description", "createdBy"]) expect(row!).toContain(f);
    expect(row!).toContain("250");
    expect(row!).toContain("hasNextPage");
    expect(read(join(PLUGIN_ROOT, "adapters", "linear.md"))).toContain("container_ownership.ts");
  });

  test("spec-write/SKILL.md: 358 split-lines, 54 STE tokens", () => {
    const body = read(SPEC_WRITE);
    expect(body.split("\n").length).toBe(358);
    expect(steTokens(body)).toBe(54);
  });

  test("spec-write line 26 keeps every STE-578 pinned substring, names no module path, and says class, owner, consent and never-offered", () => {
    const line = read(SPEC_WRITE).split("\n")[25] ?? "";
    for (const s of [
      "reconcileTrackerLocal",
      "importFromTracker",
      "resolveInterviewAnswer",
      "tracker_orphan_import",
      "requireOrRefuse",
      "defaultValue: undefined",
    ]) {
      expect(line).toContain(s);
    }
    expect(line).toMatch(/mode-none vacuous/);
    expect(line.match(MODULE_PATH_RE)).toBeNull();
    expect(line).toContain("Orphan listing");
    expect(line).toMatch(/\bowner\b/);
    expect(line).toMatch(/\bclass\b/);
    expect(line).toContain("`consent`");
    expect(line).toMatch(/sibling/);
    expect(line).toMatch(/container/);
  });

  test("docs/spec-write-tracker-mode.md gains § Orphan listing with the bun run commands and the page fields", () => {
    const doc = read(TRACKER_MODE_DOC);
    const start = doc.search(/^##+ Orphan listing/m);
    expect(start, "no § Orphan listing heading").toBeGreaterThan(-1);
    const rest = doc.slice(start + 1);
    const nextHeading = rest.search(/^## /m);
    const section = nextHeading === -1 ? rest : rest.slice(0, nextHeading);
    // Orchestrator fix (a test defect found in GREEN): shipped docs must carry
    // the `${CLAUDE_PLUGIN_ROOT}/` prefix on every `bun run adapters/` order
    // (tests/skill-path-portability.test.ts), so the command is matched with
    // the prefix allowed rather than as the bare shorthand the FR writes.
    expect(section).toMatch(/bun run [^\n`]*adapters\/_shared\/src\/container_ownership\.ts list/);
    expect(section).toMatch(/bun run [^\n`]*adapters\/_shared\/src\/container_ownership\.ts consent/);
    for (const f of ["labels", "description", "creator", "createdBy"]) expect(section).toContain(f);
  });

  test("gate-check/SKILL.md: 356 split-lines, 87 STE tokens, row 49 on line 128 runs the front door and lists the new rows", () => {
    const body = read(GATE_CHECK);
    expect(body.split("\n").length).toBe(356);
    expect(steTokens(body)).toBe(87);
    const line = body.split("\n")[127] ?? "";
    expect(line.startsWith("49. ")).toBe(true);
    expect(line).toMatch(/bun run [^\n`]*adapters\/_shared\/src\/tracker_local_reconciliation_drift\.ts/);
    for (const kind of [
      "unowned-container-ticket",
      "bound-ticket-untagged",
      "numeric-milestone-shared",
      "container-not-read",
      "container-empty",
      "container-partial",
    ]) {
      expect(line).toContain(kind);
    }
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

  test("the canonical capability-key set stays at 47", () => {
    expect(CANONICAL_CAPABILITY_KEYS.length).toBe(47);
  });

  test("reachability: row 49's two references are reachable; the new pin is one prepended ledger entry naming STE-605 (no raise)", async () => {
    // Amended by AC-STE-608.12: later FRs prepend their own moves, so this
    // FR's entry is FOUND by its rationale rather than read at position 0.
    const mine = ORDERED_UNREACHABLE_PIN_LEDGER.filter((m) => m.rationale.includes("M_947c79/STE-605"));
    expect(mine.length, "exactly one ledger entry is STE-605's").toBe(1);
    const at = ORDERED_UNREACHABLE_PIN_LEDGER.indexOf(mine[0]!);
    const previous = ORDERED_UNREACHABLE_PIN_LEDGER[at + 1]!;
    expect(previous.value).toBe(124);
    expect(previous.commit).toBe("72b853f");
    expect(mine[0]!.value).toBeLessThan(previous.value);
    const head = ORDERED_UNREACHABLE_PIN_LEDGER[0]!;
    expect(ORDERED_UNREACHABLE_PIN).toBe(head.value);
    const report = await runModuleReachabilityProbe(REPO_ROOT);
    expect(typeof report.orderedUnreachable).toBe("number");
    expect(report.orderedUnreachable).toBe(head.value);
    const row49 = report.records.filter(
      (r) => r.surface.endsWith("skills/gate-check/SKILL.md") && r.line === 128,
    );
    expect(row49.map((r) => r.module)).toContain("adapters/_shared/src/tracker_local_reconciliation_drift.ts");
    for (const r of row49) expect(r.reachable, `${r.module} on row 49 is unreachable`).toBe(true);
  }, 120_000);
});

// Stage C hardening (AUDIT advisory): the import path reads pages as strictly
// as `list` and `consent` do in a shared repository. A page lacking `labels`
// must refuse — read as "no labels", the claim would write the tag alone and
// replace the ticket's real labels.
describe("STE-605 hardening — the import never drops a label it could not read", () => {
  test("a shared-mode page lacking `labels` refuses the import before any write (control: the full page imports)", async () => {
    await withRoots(async (fe) => {
      declareJira(fe, FE_TAG);
      const store = memStore([...TWO_REPO, UNOWNED_WITH_LABEL]);
      const driver = new RecordingJiraDriver(store);
      const page = pageFromStore(store);
      const stripped = {
        ...page,
        issues: page.issues.map((row: any) => {
          if (row.key !== "GF-124") return row;
          const { labels: _drop, ...fields } = row.fields;
          return { ...row, fields };
        }),
      };
      await expect(
        importFromTracker("jira", "GF-124", providerFor(driver), join(fe, "specs"), async () => "M_GF_85", {
          projectRoot: fe,
          pages: [stripped],
        } as never),
      ).rejects.toThrow(/labels/);
      expect(driver.writes).toEqual([]);
      expect(existsSync(join(fe, "specs", "frs", "GF-124.md"))).toBe(false);
      await importFromTracker("jira", "GF-124", providerFor(driver), join(fe, "specs"), async () => "M_GF_85", {
        projectRoot: fe,
        pages: [page],
      } as never);
      expect(sorted(store.get("GF-124")!.labels)).toEqual(sorted(["milestone-M_GF_85", FE_TAG]));
    });
  });
});

describe("STE-605 — the ownership context is Jira/Linear-only", () => {
  test("a custom tracker handed container pages refuses before any write, naming why", async () => {
    await withRoots(async (fe) => {
      declareJira(fe, FE_TAG);
      const store = memStore([...TWO_REPO, UNOWNED_WITH_LABEL]);
      const driver = new RecordingJiraDriver(store);
      await expect(
        importFromTracker("github", "GF-124", providerFor(driver), join(fe, "specs"), async () => "M_GF_85", {
          projectRoot: fe,
          pages: [pageFromStore(store)],
        } as never),
      ).rejects.toThrow(/has no container pages/);
      expect(driver.writes).toEqual([]);
      expect(existsSync(join(fe, "specs", "frs", "GF-124.md"))).toBe(false);
    });
  });
});
