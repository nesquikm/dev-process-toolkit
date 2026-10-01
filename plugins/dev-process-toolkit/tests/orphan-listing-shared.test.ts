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
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CANONICAL_CAPABILITY_KEYS } from "../adapters/_shared/src/closing_summary_capability_keys";
// Namespace import: STE-653's TOOLKIT_LABELS is read off the module, so its
// absence is a failing assertion rather than a link error for the whole suite.
import * as ownershipModule from "../adapters/_shared/src/container_ownership";
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
  archivedBoundFr,
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
  jiraRow,
  keysOf,
  keysOfClass,
  linearPage,
  linearRow,
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
  const fx = makeSpanFixture("M_GF_85", { repositories: false });
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

  // Jira answers `description: null` for a ticket created without one (live: an
  // Epic `/spec-write` created, 2026-09-23); null is requested-and-empty, not missing.
  test("a shared-mode ticket whose `description` is null lists exactly as an empty description", async () => {
    await withRoots((fe) => {
      declareJira(fe, FE_TAG);
      const withNull = jiraPage(TWO_REPO);
      const withEmpty = jiraPage(TWO_REPO);
      ((withNull.issues[5] as { fields: Record<string, unknown> }).fields).description = null;
      ((withEmpty.issues[5] as { fields: Record<string, unknown> }).fields).description = "";
      const nulled = okList(list(fe, [writePage(withNull)])).stdout;
      expect(nulled).toBe(okList(list(fe, [writePage(withEmpty)])).stdout);
    });
  });

  // The twins the nullable-description carve-out needs: `description` is the ONLY
  // field whose null reads as present-and-empty. A null `labels` is the field the
  // ownership decision is made of, and a null `creator` is the field that says who
  // wrote it; neither is empty-by-shape, and a page that answers null for them was
  // not answered — it must still refuse, or the carve-out has quietly become "any
  // missing field is fine".
  for (const field of ["labels", "creator"] as const) {
    test(`REFUSAL TWIN — a shared-mode ticket whose \`${field}\` is null still refuses, and names that field`, async () => {
      await withRoots((fe) => {
        declareJira(fe, FE_TAG);
        const page = jiraPage(TWO_REPO);
        ((page.issues[5] as { fields: Record<string, unknown> }).fields)[field] = null;
        const r = list(fe, [writePage(page)]);
        expect(r.code, `expected a refusal, got:\n${r.stdout}`).not.toBe(0);
        expect(`${r.stdout}${r.stderr}`).toContain(field);
      });
    });
  }

  // The Linear call site of the same carve-out. `NULLABLE_SHARED` is one set read
  // by both, so the Jira rows above would stay green if the Linear side had been
  // missed — the mirror this milestone has already shipped seven times.
  test("LINEAR TWIN — a null `description` lists exactly as an empty one", async () => {
    await withRoots((fe) => {
      declareLinear(fe, FE_TAG);
      const rows = (): Ticket[] => [
        { key: "STE-901", title: "FE one", labels: [FE_TAG], creator: "Fe Dev", backLink: true },
        { key: "STE-903", title: "Hand filed", labels: [], creator: "Pat Manager" },
      ];
      const nulled = linearPage(rows()) as { issues?: Array<Record<string, unknown>>; [k: string]: unknown };
      const emptied = linearPage(rows()) as typeof nulled;
      const listOf = (p: typeof nulled): Array<Record<string, unknown>> =>
        (p.issues as Array<Record<string, unknown>> | undefined) ?? ((p as { nodes?: Array<Record<string, unknown>> }).nodes ?? []);
      listOf(nulled)[1]!.description = null;
      listOf(emptied)[1]!.description = "";
      expect(okList(list(fe, [writePage(nulled)])).stdout).toBe(okList(list(fe, [writePage(emptied)])).stdout);
    });
  });

  for (const field of ["labels", "createdBy"] as const) {
    test(`LINEAR REFUSAL TWIN — a null \`${field}\` still refuses, and names that field`, async () => {
      await withRoots((fe) => {
        declareLinear(fe, FE_TAG);
        const page = linearPage([
          { key: "STE-901", title: "FE one", labels: [FE_TAG], creator: "Fe Dev", backLink: true },
          { key: "STE-903", title: "Hand filed", labels: [], creator: "Pat Manager" },
        ]) as Record<string, unknown>;
        const rows = ((page.issues as Array<Record<string, unknown>> | undefined) ?? (page.nodes as Array<Record<string, unknown>>));
        rows[1]![field] = null;
        const r = list(fe, [writePage(page)]);
        expect(r.code, `expected a refusal, got:\n${r.stdout}`).not.toBe(0);
        expect(`${r.stdout}${r.stderr}`).toContain(field);
      });
    });
  }

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

// ===========================================================================
// STE-653 (M_a85e46) — the container listing grades only this project's open
// tickets. Filter by AC with `bun test -t "AC-STE-653.N"`.
//
// HEAD comparisons run the PRE-CHANGE front doors, extracted with
// `git show cb6145c1:...` (v2.92.0 on main, so a rebase of this branch cannot orphan it), plus their imports, over the same pages. The listing, consent and drift modules are byte-identical there and at the pre-STE-653 branch tip; two of their imports (reconcile_tracker_local.ts, STE-652, and milestone_token.ts, STE-651) differ, so the baseline is MAIN — on these pages (no `shared` reconcile option, no Epic listing) the two read alike.
// ===========================================================================

const STE653_BASE_SHA = "cb6145c1";
const OWNERSHIP_REL = "plugins/dev-process-toolkit/adapters/_shared/src/container_ownership.ts";
const DRIFT_REL = "plugins/dev-process-toolkit/adapters/_shared/src/tracker_local_reconciliation_drift.ts";
const TICKET_OWNERSHIP_MODULE = join(PLUGIN_ROOT, "adapters", "_shared", "src", "ticket_ownership.ts");
const NTR = "needs-technical-review";

let baseDir = "";
let baseOwnership = "";
let baseDrift = "";
function baseModules(): { ownership: string; drift: string } {
  if (baseDir === "") {
    baseDir = mkdtempSync(join(tmpdir(), "dpt-ste653-base-"));
    const seen = new Set<string>();
    baseOwnership = extractAt(STE653_BASE_SHA, OWNERSHIP_REL, baseDir, seen);
    baseDrift = extractAt(STE653_BASE_SHA, DRIFT_REL, baseDir, seen);
  }
  return { ownership: baseOwnership, drift: baseDrift };
}
afterAll(() => {
  if (baseDir !== "") rmSync(baseDir, { recursive: true, force: true });
});

const baseList = (root: string, pages: string[]): Run =>
  spawnModule(baseModules().ownership, ["list", root, ...pages], env());
const baseConsent = (root: string, key: string, pages: string[]): Run =>
  spawnModule(baseModules().ownership, ["consent", root, key, ...pages], env());
const baseProbe = (root: string, pages: string[]): Run => spawnModule(baseModules().drift, [root, ...pages], env());

const jiraRowsPage = (rows: Record<string, unknown>[]) => ({ issues: rows, isLast: true });
const linearRowsPage = (rows: Record<string, unknown>[]) => ({ issues: rows, hasNextPage: false });

const receiptPaths = (run: Run) =>
  run.stdout
    .split("\n")
    .filter((l) => l.startsWith(RECEIPT_ANNOUNCEMENT_PREFIX))
    .map((l) => parseReceiptAnnouncement(l)!.path);

/** The FE binding as `readWorkspaceBinding` returns it for `declareJira(root, FE_TAG)`. */
const FE_BINDING = { shared: true, repoTag: FE_TAG, defaultLabels: [FE_TAG], project: "GF", minDptVersion: "2.87.0" };
const BE_BINDING = { shared: true, repoTag: BE_TAG, defaultLabels: [BE_TAG], project: "GF", minDptVersion: "2.87.0" };
const asTicket = (t: Ticket) => ownershipModule.normalizeContainerItems([jiraIssue(t)], "jira", true)[0]!;

const T_NTR_ONLY: Ticket = { key: "GF-161", title: "Untagged no-tech FR", labels: [NTR], creator: "Pat Manager", backLink: true };
const T_NTR_MILESTONE: Ticket = { key: "GF-162", title: "Untagged no-tech FR under an Epic", labels: ["milestone-M_GF_92", NTR], creator: "Pat Manager" };
const T_BE_NTR: Ticket = { key: "GF-163", title: "BE no-tech FR", labels: [BE_TAG, NTR], creator: "Be Dev", backLink: true };
const T_FE_NTR: Ticket = { key: "GF-164", title: "FE no-tech FR", labels: [FE_TAG, NTR], creator: "Fe Dev", backLink: true };

// ---------------------------------------------------------------------------
// C-F5 — the toolkit's own label is not a sibling's tag.
// ---------------------------------------------------------------------------

describe("STE-653 — toolkit-owned labels are not sibling tags", () => {
  test("AC-STE-653.1 (a) — classifyTicket: an untagged ticket whose only label is needs-technical-review is unowned for FE and for BE", () => {
    for (const binding of [FE_BINDING, BE_BINDING]) {
      expect(ownershipModule.classifyTicket(asTicket(T_NTR_ONLY), binding as never)).toBe("unowned");
    }
  });

  test("AC-STE-653.1 (b) — [milestone-M_GF_92, needs-technical-review] is unowned", () => {
    expect(ownershipModule.classifyTicket(asTicket(T_NTR_MILESTONE), FE_BINDING as never)).toBe("unowned");
  });

  test("AC-STE-653.1 — listOrphans (front door) offers it in FE and in BE with the Import/Skip options line", async () => {
    await withRoots((fe, be) => {
      declareJira(fe, FE_TAG);
      declareJira(be, BE_TAG);
      const page = writePage(jiraPage([...TWO_REPO, T_NTR_ONLY, T_NTR_MILESTONE]));
      for (const root of [fe, be]) {
        const out = okList(list(root, [page])).stdout;
        const cls = classes(out);
        expect(cls.get("GF-161"), out).toBe("unowned");
        expect(cls.get("GF-162"), out).toBe("unowned");
        const lines = out.split("\n");
        expect(lines).toContain("options: Import GF-161 | Skip GF-161");
        expect(lines).toContain("options: Import GF-162 | Skip GF-162");
      }
    });
  });

  test("AC-STE-653.2 (c) — ticket_ownership decide gives verdict unowned with options [Adopt GF-161, Skip GF-161]", async () => {
    await withRoots((fe) => {
      declareJira(fe, FE_TAG);
      const ticketPath = writePage(jiraIssue(T_NTR_ONLY));
      const run = spawnModule(TICKET_OWNERSHIP_MODULE, ["decide", fe, ticketPath], env());
      expect(run.code, run.stderr).toBe(0);
      const decision = JSON.parse(run.stdout.trim().split("\n")[0]!) as { verdict: string; options?: string[] };
      expect(decision.verdict).toBe("unowned");
      expect(decision.options).toEqual(["Adopt GF-161", "Skip GF-161"]);
    });
  });

  test("AC-STE-653.2 CONTROL — decide on [glacy-be, needs-technical-review] in FE is still foreign-repo", async () => {
    await withRoots((fe) => {
      declareJira(fe, FE_TAG);
      const run = spawnModule(TICKET_OWNERSHIP_MODULE, ["decide", fe, writePage(jiraIssue(T_BE_NTR))], env());
      expect(run.code, run.stderr).toBe(0);
      expect((JSON.parse(run.stdout.trim().split("\n")[0]!) as { verdict: string }).verdict).toBe("foreign-repo");
    });
  });

  test("AC-STE-653.3 (f) — [glacy-be, needs-technical-review] in FE is sibling, and foreignLabels is exactly [glacy-be]", () => {
    const t = asTicket(T_BE_NTR);
    expect(ownershipModule.classifyTicket(t, FE_BINDING as never)).toBe("sibling");
    expect(ownershipModule.foreignLabels(t, FE_BINDING as never)).toEqual([BE_TAG]);
  });

  test("AC-STE-653.3 (e) CONTROL — [glacy-be] in FE is sibling (red under an over-exempting foreignLabels)", () => {
    const t = asTicket(BE_TICKETS[0]!);
    expect(ownershipModule.classifyTicket(t, FE_BINDING as never)).toBe("sibling");
    expect(ownershipModule.foreignLabels(t, FE_BINDING as never)).toEqual([BE_TAG]);
  });

  test("AC-STE-653.3 — the front door lists [glacy-be, needs-technical-review] as sibling in FE and never offers it", async () => {
    await withRoots((fe) => {
      declareJira(fe, FE_TAG);
      const out = okList(list(fe, [writePage(jiraPage([...TWO_REPO, T_BE_NTR]))])).stdout;
      expect(classes(out).get("GF-163")).toBe("sibling");
      expect(offered(out)).not.toContain("GF-163");
    });
  });

  test("AC-STE-653.4 (g) — [glacy-fe, needs-technical-review] in FE is ours", async () => {
    expect(ownershipModule.classifyTicket(asTicket(T_FE_NTR), FE_BINDING as never)).toBe("ours");
    await withRoots((fe) => {
      declareJira(fe, FE_TAG);
      const out = okList(list(fe, [writePage(jiraPage([...TWO_REPO, T_FE_NTR]))])).stdout;
      expect(classes(out).get("GF-164")).toBe("ours");
      expect(offered(out)).toContain("GF-164");
    });
  });

  test("AC-STE-653.5 (d) — numeric-milestone-shared names three sides when two siblings share only needs-technical-review", async () => {
    await withRoots((fe) => {
      declareJira(fe, FE_TAG);
      const tickets: Ticket[] = [
        { key: "GF-171", title: "BE M8", labels: [BE_TAG, NTR, "milestone-M8"], creator: "Be Dev", backLink: true },
        { key: "GF-172", title: "X M8", labels: ["glacy-x", NTR, "milestone-M8"], creator: "X Dev", backLink: true },
        { key: "GF-173", title: "FE M8", labels: [FE_TAG, "milestone-M8"], creator: "Fe Dev", backLink: true },
      ];
      const run = probe(fe, [writePage(jiraPage(tickets))]);
      expect(run.stdout, run.stderr).toMatch(/excluded/);
      const rows = run.stdout.split("\n").filter((l) => l.includes("numeric-milestone-shared"));
      expect(rows.length, run.stdout).toBe(1);
      const sides = /\(([^()]*)\)/.exec(rows[0]!)?.[1] ?? "";
      expect(sides.split("; ").length, rows[0]).toBe(3);
      expect(rows[0]).not.toContain(NTR);
      for (const k of ["GF-171", "GF-172", "GF-173"]) expect(rows[0]).toContain(k);
    });
  });

  test("AC-STE-653.5 CONTROL — one sibling's two tickets that share needs-technical-review stay one side (no row)", async () => {
    await withRoots((fe) => {
      declareJira(fe, FE_TAG);
      const tickets: Ticket[] = [
        { key: "GF-174", title: "BE M8 a", labels: [BE_TAG, NTR, "milestone-M8"], creator: "Be Dev", backLink: true },
        { key: "GF-175", title: "BE M8 b", labels: [BE_TAG, "milestone-M8"], creator: "Be Dev", backLink: true },
      ];
      const run = probe(fe, [writePage(jiraPage(tickets))]);
      expect(run.stdout, run.stderr).toMatch(/excluded/);
      expect(run.stdout.split("\n").filter((l) => l.includes("numeric-milestone-shared"))).toEqual([]);
    });
  });

  test("AC-STE-653.6 (h) — the --no-tech labels literal in spec-write/SKILL.md is a member of the exported TOOLKIT_LABELS", () => {
    const skill = readFileSync(join(PLUGIN_ROOT, "skills", "spec-write", "SKILL.md"), "utf-8");
    const hits = [...skill.matchAll(/labels: \[\.\.\.\(defaultLabels \?\? \[\]\), "([^"]+)"\]/g)].map((m) => m[1]!);
    expect(hits.length, "the --no-tech labels-array literal is no longer found in spec-write/SKILL.md").toBeGreaterThan(0);
    const labels = (ownershipModule as Record<string, unknown>).TOOLKIT_LABELS as ReadonlySet<string> | undefined;
    expect(labels instanceof Set, "container_ownership.ts exports no TOOLKIT_LABELS set").toBe(true);
    for (const l of hits) expect(labels!.has(l), `${l} is written by spec-write --no-tech but not in TOOLKIT_LABELS`).toBe(true);
    // CONTROL: the set is not a catch-all — this repository's tag and a milestone label are not toolkit labels.
    expect(labels!.has(FE_TAG)).toBe(false);
    expect(labels!.has("milestone-M8")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-653.7 — matrix rows (h) and (u) still find their anchors and still go red.
// ---------------------------------------------------------------------------

const MATRIX_FILE = join(PLUGIN_ROOT, "tests", "m_2306b6-ste-616-guard-mutation-matrix.test.ts");

/** One quoted field (`find`/`replace`/`file`) of the matrix row `letter`, read from the suite's source. */
function matrixField(letter: string, field: "find" | "replace" | "file"): string {
  const line = readFileSync(MATRIX_FILE, "utf-8")
    .split("\n")
    .find((l) => l.includes(`{ row: "${letter}",`));
  if (line === undefined) throw new Error(`matrix row (${letter}) not found`);
  const m = new RegExp(`\\b${field}: (?:'([^']*)'|"((?:[^"\\\\]|\\\\.)*)"|\`([^\`]*)\`)`).exec(line);
  if (!m) throw new Error(`matrix row (${letter}) has no ${field}`);
  if (m[1] !== undefined) return m[1];
  if (m[2] !== undefined) return JSON.parse(`"${m[2]}"`) as string;
  return m[3]!.replace("${S}", "adapters/_shared/src");
}

describe("AC-STE-653.7 — matrix rows (h) and (u) keep their anchors and still go red", () => {
  const SOURCE = () => readFileSync(OWNERSHIP_MODULE, "utf-8");

  for (const letter of ["h", "u"]) {
    test(`AC-STE-653.7 — row (${letter})'s find string occurs exactly once in container_ownership.ts`, () => {
      expect(matrixField(letter, "file")).toBe("adapters/_shared/src/container_ownership.ts");
      const find = matrixField(letter, "find");
      expect(SOURCE().split(find).length - 1, `row (${letter}) anchor ${JSON.stringify(find)}`).toBe(1);
    });
  }

  const legs: { letter: string; key: string; expected: string }[] = [
    { letter: "h", key: "GF-121", expected: "unowned" }, // the untagged ticket reads as tagged
    { letter: "u", key: "GF-111", expected: "sibling" }, // the sibling's ticket reads as unowned
  ];
  for (const leg of legs) {
    test(`AC-STE-653.7 — row (${leg.letter})'s mutation turns ${leg.key}'s class away from ${leg.expected} (unmutated: ${leg.expected})`, async () => {
      const copy = mkdtempSync(join(tmpdir(), `dpt-ste653-row-${leg.letter}-`));
      try {
        cpSync(join(PLUGIN_ROOT, "adapters"), join(copy, "adapters"), { recursive: true });
        const target = join(copy, "adapters", "_shared", "src", "container_ownership.ts");
        const body = readFileSync(target, "utf-8");
        const find = matrixField(leg.letter, "find");
        expect(body.split(find).length - 1).toBe(1);
        writeFileSync(target, body.replace(find, matrixField(leg.letter, "replace")));
        await withRoots((fe) => {
          declareJira(fe, FE_TAG);
          const page = writePage(jiraPage(TWO_REPO));
          expect(classes(okList(list(fe, [page])).stdout).get(leg.key)).toBe(leg.expected);
          const mutated = spawnModule(target, ["list", fe, page], env());
          expect(mutated.code, mutated.stderr).toBe(0);
          expect(classes(mutated.stdout).get(leg.key)).not.toBe(leg.expected);
        });
      } finally {
        rmSync(copy, { recursive: true, force: true });
      }
    });
  }
});

// ---------------------------------------------------------------------------
// C-ORPH — closed tickets and archived bindings are never offered.
// ---------------------------------------------------------------------------

const T_CLOSED: Ticket = { key: "GF-301", title: "Shipped and closed", labels: [], creator: "Pat Manager" };
const T_CLOSED_OURS: Ticket = { key: "GF-302", title: "Our shipped one", labels: [FE_TAG], creator: "Fe Dev", backLink: true };
const T_ARCHIVED: Ticket = { key: "GF-303", title: "Archived here", labels: [FE_TAG], creator: "Fe Dev", backLink: true };

const linearClosedRows = (): Record<string, unknown>[] => [
  linearRow({ key: "STE-911", title: "Completed", labels: [], creator: "Pat Manager" }, { statusType: "completed", completedAt: "2026-09-20T00:00:00Z", canceledAt: null }),
  linearRow({ key: "STE-912", title: "Canceled", labels: [], creator: "Pat Manager" }, { statusType: "canceled", completedAt: null, canceledAt: "2026-09-20T00:00:00Z" }),
  linearRow({ key: "STE-913", title: "Started, completedAt set", labels: [FE_TAG], creator: "Fe Dev" }, { statusType: "started", completedAt: "2026-09-20T00:00:00Z", canceledAt: null }),
  linearRow({ key: "STE-914", title: "Started, canceledAt set", labels: [], creator: "Pat Manager" }, { statusType: "started", completedAt: null, canceledAt: "2026-09-20T00:00:00Z" }),
];
const linearOpenRows = (): Record<string, unknown>[] => [
  linearRow({ key: "STE-915", title: "Started", labels: [], creator: "Pat Manager" }, { statusType: "started", completedAt: null, canceledAt: null }),
  linearRow({ key: "STE-916", title: "Backlog", labels: [FE_TAG], creator: "Fe Dev" }, { statusType: "backlog", completedAt: null, canceledAt: null }),
  linearRow({ key: "STE-917", title: "No status fields", labels: [], creator: "Pat Manager" }),
];

describe("STE-653 — closed tickets are not offered", () => {
  test("AC-STE-653.8 (a) — a Jira ticket in status category done is not offered, has no options line, and the summary counts closed=2", async () => {
    await withRoots((fe) => {
      declareJira(fe, FE_TAG);
      const rows = [
        ...TWO_REPO.map((t) => jiraIssue(t)),
        jiraRow(T_CLOSED, { statusCategory: "done" }),
        jiraRow(T_CLOSED_OURS, { statusCategory: "done" }),
      ];
      const out = okList(list(fe, [writePage(jiraRowsPage(rows))])).stdout;
      for (const k of ["GF-301", "GF-302"]) {
        expect(offered(out), out).not.toContain(k);
        expect(out).not.toContain(`Skip ${k}`);
      }
      const s = summary(out)!;
      expect(s.line).toMatch(/\bclosed=2\b/);
      expect(s.counts.read).toBe(TWO_REPO.length + 2);
      expect(s.complete).toBe(true);
      // CONTROL: the open tickets on the same page are still offered.
      expect(offered(out)).toEqual(expect.arrayContaining(["GF-102", "GF-121"]));
    });
  });

  test("AC-STE-653.8 (b) — Linear: statusType completed or canceled, or a non-null completedAt or canceledAt, is not offered; summary closed=4", async () => {
    await withRoots((fe) => {
      declareLinear(fe, FE_TAG);
      const out = okList(list(fe, [writePage(linearRowsPage([...linearClosedRows(), ...linearOpenRows()]))])).stdout;
      for (const k of ["STE-911", "STE-912", "STE-913", "STE-914"]) {
        expect(offered(out), out).not.toContain(k);
        expect(out).not.toContain(`Skip ${k}`);
      }
      expect(summary(out)!.line).toMatch(/\bclosed=4\b/);
      expect(summary(out)!.complete).toBe(true);
    });
  });

  test("AC-STE-653.8 (b′) hardening (review r0) — statusType completed or canceled ALONE (both timestamps null) is closed; red under an emptied closed-status set", async () => {
    await withRoots((fe) => {
      declareLinear(fe, FE_TAG);
      const rows = [
        linearRow({ key: "STE-918", title: "Completed, no timestamp", labels: [], creator: "Pat Manager" }, { statusType: "completed", completedAt: null, canceledAt: null }),
        linearRow({ key: "STE-919", title: "Canceled, no timestamp", labels: [], creator: "Pat Manager" }, { statusType: "canceled", completedAt: null, canceledAt: null }),
        ...linearOpenRows(),
      ];
      const out = okList(list(fe, [writePage(linearRowsPage(rows))])).stdout;
      for (const k of ["STE-918", "STE-919"]) {
        expect(offered(out), out).not.toContain(k);
        expect(out).not.toContain(`Skip ${k}`);
      }
      expect(summary(out)!.line).toMatch(/\bclosed=2\b/);
      expect(offered(out)).toEqual(["STE-915", "STE-916", "STE-917"]);
    });
  });

  test("AC-STE-653.12 CONTROL — open statuses and absent status fields are still offered (red under a mark-everything-closed mutation)", async () => {
    await withRoots((fe, be) => {
      declareLinear(fe, FE_TAG);
      const lin = okList(list(fe, [writePage(linearRowsPage(linearOpenRows()))])).stdout;
      expect(offered(lin)).toEqual(["STE-915", "STE-916", "STE-917"]);
      declareJira(be, FE_TAG);
      const rows = [
        jiraRow({ key: "GF-311", title: "In progress", labels: [], creator: "Pat Manager" }, { statusCategory: "indeterminate" }),
        jiraRow({ key: "GF-312", title: "To do", labels: [FE_TAG], creator: "Fe Dev" }, { statusCategory: "new" }),
        jiraRow({ key: "GF-313", title: "No status", labels: [], creator: "Pat Manager" }),
      ];
      const jir = okList(list(be, [writePage(jiraRowsPage(rows))])).stdout;
      expect(offered(jir)).toEqual(["GF-311", "GF-312", "GF-313"]);
    });
  });

  test("AC-STE-653.12 — open-status pages list byte-identically to HEAD (Jira and Linear)", async () => {
    await withRoots((fe, be) => {
      declareJira(fe, FE_TAG);
      const jRows = TWO_REPO.map((t, i) => jiraRow(t, { statusCategory: i % 2 === 0 ? "new" : "indeterminate" }));
      const jPage = writePage(jiraRowsPage(jRows));
      const now = okList(list(fe, [jPage]));
      const base = okList(baseList(fe, [jPage]));
      expect(now.stdout).toBe(base.stdout);
      declareLinear(be, FE_TAG);
      const lPage = writePage(linearRowsPage(linearOpenRows()));
      expect(okList(list(be, [lPage])).stdout).toBe(okList(baseList(be, [lPage])).stdout);
    });
  });

  test("AC-STE-653.9 (c) — a ticket bound only by specs/frs/archive/<KEY>.md counts bound=1 and is not listed", async () => {
    await withRoots((fe) => {
      declareJira(fe, FE_TAG);
      archivedBoundFr(fe, "GF-303");
      const out = okList(list(fe, [writePage(jiraPage([...TWO_REPO, T_ARCHIVED]))])).stdout;
      expect(summary(out)!.counts.bound).toBe(1);
      expect(tableRows(out).map((r) => r.key)).not.toContain("GF-303");
      expect(offered(out)).not.toContain("GF-303");
    });
  });

  test("AC-STE-653.9 CONTROL — the same ticket with no archived FR is listed and offered (bound=0)", async () => {
    await withRoots((fe) => {
      declareJira(fe, FE_TAG);
      const out = okList(list(fe, [writePage(jiraPage([...TWO_REPO, T_ARCHIVED]))])).stdout;
      expect(summary(out)!.counts.bound).toBe(0);
      expect(offered(out)).toContain("GF-303");
    });
  });

  for (const [label, makeRoot, key, page] of [
    ["Jira done", (r: string) => declareJira(r, FE_TAG), "GF-301", () => jiraRowsPage([...TWO_REPO.map((t) => jiraIssue(t)), jiraRow(T_CLOSED, { statusCategory: "done" })])],
    ["Linear completed", (r: string) => declareLinear(r, FE_TAG), "STE-911", () => linearRowsPage([...linearClosedRows(), ...linearOpenRows()])],
  ] as const) {
    test(`AC-STE-653.10 (d) — consent on the closed key (${label}) exits 1 and writes nothing`, async () => {
      await withRoots((fe) => {
        makeRoot(fe);
        const p = writePage(page());
        const before = snapshotTree(fe);
        const run = consent(fe, key, [p]);
        expect(run.code, `${run.stdout}${run.stderr}`).toBe(1);
        expect(run.stderr).toContain(key);
        expect(receiptPaths(run)).toEqual([]);
        expect(readSessionReceipts(fe, SESSION).receipts).toEqual([]);
        expect(snapshotTree(fe)).toEqual(before);
      });
    });
  }

  test("AC-STE-653.10 CONTROL — consent on an OPEN unowned key on the same page still writes one import receipt", async () => {
    await withRoots((fe) => {
      declareJira(fe, FE_TAG);
      const p = writePage(jiraRowsPage([...TWO_REPO.map((t) => jiraIssue(t)), jiraRow(T_CLOSED, { statusCategory: "done" })]));
      const run = consent(fe, "GF-121", [p]);
      expect(run.code, run.stderr).toBe(0);
      expect(receiptPaths(run).length).toBe(1);
    });
  });

  test("AC-STE-653.13 — the Linear closed-status vocabulary carries its provenance: the measuring bundles and the values not yet measured live", () => {
    const bundles = ["linear-2026-09-25-shr15b24814", "linear-2026-09-25-shr8f740e57", "linear-2026-09-26-shrced1db1d"];
    // Guard: the bundles named are real fixtures, so the comment cites evidence that exists.
    for (const b of bundles) expect(existsSync(join(PLUGIN_ROOT, "tests", "fixtures", "shared-tracker-live", b)), b).toBe(true);
    const srcDir = join(PLUGIN_ROOT, "adapters", "_shared", "src");
    const homes = [...new Glob("*.ts").scanSync(srcDir)]
      .filter((f) => !f.endsWith(".test.ts"))
      .map((f) => readFileSync(join(srcDir, f), "utf-8"))
      .filter((s) => s.includes('"completed"') && s.includes('"canceled"') && /completedAt/.test(s) && /canceledAt/.test(s));
    expect(homes.length, "no source file carries the Linear closed vocabulary (completed, canceled, completedAt, canceledAt)").toBeGreaterThan(0);
    for (const body of homes) {
      for (const b of bundles) expect(body).toContain(b);
      expect(body).toMatch(/unmeasured|not (?:yet )?measured/i);
    }
  });
});

// ---------------------------------------------------------------------------
// C-P49 — a shared binding refuses pages from another project or Linear team.
// ---------------------------------------------------------------------------

const T_GB: Ticket = { key: "GB-12", title: "Another project's bug", labels: [], creator: "Gb Person" };
const gbPage = () => jiraRowsPage([...TWO_REPO.map((t) => jiraIssue(t)), jiraRow(T_GB, { project: "GB" })]);
const notKeyed = (s: string, token: string) => new RegExp(`(^|[^A-Za-z0-9])${token}(?![-A-Za-z0-9])`).test(s);

describe("STE-653 — foreign-project pages refuse in a shared binding", () => {
  function expectListingRefused(run: Run, names: string[]): void {
    expect(run.code, `expected exit 1\n${run.stdout}${run.stderr}`).toBe(1);
    for (const n of names) expect(notKeyed(run.stderr, n) || run.stderr.includes(`${n}`), `stderr names ${n}\n${run.stderr}`).toBe(true);
    expect(tableRows(run.stdout)).toEqual([]);
    expect(offered(run.stdout)).toEqual([]);
    expect(run.stdout).not.toMatch(/^summary:/m);
  }

  test("AC-STE-653.14 (a) — Jira: a GB-project ticket on a GF shared repo's page refuses the list, naming GB-12, GB and GF", async () => {
    await withRoots((fe) => {
      declareJira(fe, FE_TAG);
      const before = snapshotTree(fe);
      const run = list(fe, [writePage(gbPage())]);
      expectListingRefused(run, ["GB-12"]);
      expect(notKeyed(run.stderr, "GB"), run.stderr).toBe(true);
      expect(notKeyed(run.stderr, "GF"), run.stderr).toBe(true);
      expect(snapshotTree(fe)).toEqual(before);
    });
  });

  test("AC-STE-653.14 (d) — Linear: a row in project Other against binding DPT refuses, naming the ticket, Other and DPT", async () => {
    await withRoots((fe) => {
      declareLinear(fe, FE_TAG);
      const rows = [...linearOpenRows(), linearRow({ key: "STE-920", title: "Other project", labels: [], creator: "Pat Manager" }, { project: "Other" })];
      const run = list(fe, [writePage(linearRowsPage(rows))]);
      expectListingRefused(run, ["STE-920"]);
      expect(notKeyed(run.stderr, "Other"), run.stderr).toBe(true);
      expect(notKeyed(run.stderr, "DPT"), run.stderr).toBe(true);
    });
  });

  test("AC-STE-653.14 (e) — Linear: a row in project DPT whose key is another team's (ABC-12 vs STE) refuses, naming ABC-12, ABC and STE", async () => {
    await withRoots((fe) => {
      declareLinear(fe, FE_TAG);
      const rows = [...linearOpenRows(), linearRow({ key: "ABC-12", title: "Other team", labels: [], creator: "Pat Manager" })];
      const run = list(fe, [writePage(linearRowsPage(rows))]);
      expectListingRefused(run, ["ABC-12"]);
      expect(notKeyed(run.stderr, "ABC"), run.stderr).toBe(true);
      expect(notKeyed(run.stderr, "STE"), run.stderr).toBe(true);
    });
  });

  for (const key of ["GB-12", "GF-121"]) {
    test(`AC-STE-653.15 (b) — consent on ${key} over a page carrying GB-12 exits 1 and writes zero receipts`, async () => {
      await withRoots((fe) => {
        declareJira(fe, FE_TAG);
        const p = writePage(gbPage());
        const before = snapshotTree(fe);
        const run = consent(fe, key, [p]);
        expect(run.code, `${run.stdout}${run.stderr}`).toBe(1);
        expect(run.stderr).toContain("GB-12");
        expect(receiptPaths(run)).toEqual([]);
        expect(readSessionReceipts(fe, SESSION).receipts).toEqual([]);
        expect(snapshotTree(fe)).toEqual(before);
      });
    });
  }

  for (const key of ["GB-12", "GF-124"]) {
    test(`AC-STE-653.17 (f) — importFromTracker(${key}) with a page carrying GB-12 refuses before any file write or sync`, async () => {
      await withRoots(async (fe) => {
        declareJira(fe, FE_TAG);
        const store = memStore([...TWO_REPO, UNOWNED_WITH_LABEL, T_GB]);
        const driver = new RecordingJiraDriver(store);
        const rows = [...store.values()].map((t) => (t.key === "GB-12" ? jiraRow(t, { project: "GB" }) : jiraIssue(t)));
        const before = snapshotTree(fe);
        await expect(
          importFromTracker("jira", key, providerFor(driver), join(fe, "specs"), async () => "M_GF_85", {
            projectRoot: fe,
            pages: [jiraRowsPage(rows)],
          } as never),
        ).rejects.toThrow(/GB-12/);
        expect(driver.writes).toEqual([]);
        expect(existsSync(join(fe, "specs", "frs", `${key}.md`))).toBe(false);
        expect(snapshotTree(fe)).toEqual(before);
      });
    });
  }

  test("AC-STE-653.24 — importFromTracker of a CLOSED ticket on the pages refuses before any write; the same ticket open imports", async () => {
    await withRoots(async (fe) => {
      declareJira(fe, FE_TAG);
      const key = UNOWNED_WITH_LABEL.key;
      const run = async (status: string) => {
        const store = memStore([...TWO_REPO, UNOWNED_WITH_LABEL]);
        const driver = new RecordingJiraDriver(store);
        const rows = [...store.values()].map((t) => (t.key === key ? jiraRow(t, { statusCategory: status }) : jiraIssue(t)));
        const out = importFromTracker("jira", key, providerFor(driver), join(fe, "specs"), async () => "M_GF_85", {
          projectRoot: fe,
          pages: [jiraRowsPage(rows)],
        } as never);
        return { out, driver };
      };
      const before = snapshotTree(fe);
      const closed = await run("done");
      await expect(closed.out).rejects.toThrow(/closed/);
      expect(closed.driver.writes).toEqual([]);
      expect(snapshotTree(fe)).toEqual(before);
      // Opposite break: an open ticket with the same labels still imports.
      const open = await run("indeterminate");
      await open.out;
      expect(existsSync(join(fe, "specs", "frs", `${key}.md`))).toBe(true);
    });
  });

  test("AC-STE-653.18 (g) — all-GF Jira pages: list, probe and consent are byte-identical to HEAD", async () => {
    await withRoots((fe, be) => {
      declareJira(fe, FE_TAG);
      declareJira(be, FE_TAG);
      const p = writePage(jiraPage(TWO_REPO));
      const nowList = okList(list(fe, [p]));
      expect(nowList.stdout).toBe(okList(baseList(fe, [p])).stdout);
      const nowProbe = probe(fe, [p]);
      const baseRun = baseProbe(fe, [p]);
      expect({ code: nowProbe.code, out: nowProbe.stdout }).toEqual({ code: baseRun.code, out: baseRun.stdout });
      const c1 = consent(fe, "GF-121", [p]);
      const c2 = baseConsent(be, "GF-121", [p]);
      expect({ code: c1.code, receipts: receiptPaths(c1).length }).toEqual({ code: c2.code, receipts: receiptPaths(c2).length });
      expect(c1.code).toBe(0);
    });
  });

  test("AC-STE-653.18 (g) — all-STE/DPT Linear pages list byte-identically to HEAD", async () => {
    await withRoots((fe) => {
      declareLinear(fe, FE_TAG);
      const p = writePage(linearRowsPage(linearOpenRows()));
      expect(okList(list(fe, [p])).stdout).toBe(okList(baseList(fe, [p])).stdout);
    });
  });

  test("AC-STE-653.19 (h) — unshared Jira: a page carrying GB-12 is graded exactly as at HEAD by list, probe, consent and import", async () => {
    await withRoots(async (fe, be) => {
      declareJira(fe, null);
      declareJira(be, null);
      const p = writePage(gbPage());
      const nowList = okList(list(fe, [p]));
      expect(nowList.stdout).toBe(okList(baseList(fe, [p])).stdout);
      expect(offered(nowList.stdout)).toContain("GB-12");
      const nowProbe = probe(fe, [p]);
      const baseRun = baseProbe(fe, [p]);
      expect({ code: nowProbe.code, out: nowProbe.stdout }).toEqual({ code: baseRun.code, out: baseRun.stdout });
      const before = snapshotTree(fe);
      const c = consent(fe, "GB-12", [p]);
      expect(c.code, c.stderr).toBe(0);
      expect(receiptPaths(c)).toEqual([]);
      expect(snapshotTree(fe)).toEqual(before);
      const store = memStore([...TWO_REPO, T_GB]);
      const driver = new RecordingJiraDriver(store);
      const rows = [...store.values()].map((t) => (t.key === "GB-12" ? jiraRow(t, { project: "GB" }) : jiraIssue(t)));
      await importFromTracker("jira", "GB-12", providerFor(driver), join(be, "specs"), async () => "M_GF_85", {
        projectRoot: be,
        pages: [jiraRowsPage(rows)],
      } as never);
      expect(existsSync(join(be, "specs", "frs", "GB-12.md"))).toBe(true);
    });
  });

  test("AC-STE-653.19 (h) — unshared Linear: a row in another project and another team lists exactly as at HEAD", async () => {
    await withRoots((fe) => {
      declareLinear(fe, null);
      const rows = [
        ...linearOpenRows(),
        linearRow({ key: "STE-920", title: "Other project", labels: [], creator: "Pat Manager" }, { project: "Other" }),
        linearRow({ key: "ABC-12", title: "Other team", labels: [], creator: "Pat Manager" }),
      ];
      const p = writePage(linearRowsPage(rows));
      const now = okList(list(fe, [p]));
      expect(now.stdout).toBe(okList(baseList(fe, [p])).stdout);
      expect(offered(now.stdout)).toEqual(expect.arrayContaining(["ABC-12", "STE-920"]));
    });
  });
});
