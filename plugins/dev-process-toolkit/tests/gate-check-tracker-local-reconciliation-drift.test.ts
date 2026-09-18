// STE-284 AC-STE-284.4 — `tracker_local_reconciliation_drift` probe.
//
// Three cases:
//   - clean-sync: no drift → severity = info / no violations
//   - drift-warning: any drift (orphans on either side, milestone mismatch)
//       → severity = warning, one note per drift row
//   - hard-collision-error: same tracker ID bound to two local files, OR
//       local FR pointing to non-existent tracker ID → severity = error
//
// The probe itself lives at
// `plugins/dev-process-toolkit/adapters/_shared/src/tracker_local_reconciliation_drift.ts`
// per AC-STE-324.5 (relocated from skills/gate-check/probes/ to the canonical
// adapters/_shared/src/ path matching 55 sibling probes); we import it from there.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTrackerLocalReconciliationDriftProbe } from "../adapters/_shared/src/tracker_local_reconciliation_drift";
import type { FRMetadata, FRSpec, LockResult, Provider, SyncResult } from "../adapters/_shared/src/provider";
// STE-605 (M_947c79) — the shared fixtures, the Epic fixture and the #49
// front-door legs. Output framing: see `tests/_orphan_pages.ts`.
import { afterAll, beforeAll } from "bun:test";
import {
  BE_TAG,
  boundFr,
  declareJira,
  DRIFT_MODULE,
  FE_TAG,
  jiraPage,
  probeRowKeys,
  probeRows,
  type Run,
  snapshotTree,
  spawnModule,
  type Ticket,
  TWO_REPO,
} from "./_orphan_pages";
import { claudeMd, makeSpanFixture, pluginManifest } from "./_span_fixture";

class StubTrackerProvider implements Provider {
  readonly mode = "tracker" as const;
  constructor(
    private readonly activeFRs: string[],
    private readonly milestones: { name: string }[],
  ) {}
  async listActiveFRs(): Promise<string[]> {
    return [...this.activeFRs];
  }
  async listMilestones(): Promise<{ name: string }[]> {
    return [...this.milestones];
  }
  async getMetadata(id: string): Promise<FRMetadata> {
    return { id, title: "", milestone: "", status: "active", tracker: {}, inFlightBranch: null, assignee: null };
  }
  async sync(_spec: FRSpec): Promise<SyncResult> {
    return { kind: "skipped", updated: [], conflicts: [], message: "" };
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
    return { status: "in_progress" };
  }
  filenameFor(_spec: FRSpec): string {
    return "stub.md";
  }
}

function makeProject(): { root: string; specsDir: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "tracker-local-drift-"));
  const specsDir = join(root, "specs");
  mkdirSync(join(specsDir, "frs"), { recursive: true });
  mkdirSync(join(specsDir, "frs", "archive"), { recursive: true });
  mkdirSync(join(specsDir, "plan"), { recursive: true });
  mkdirSync(join(specsDir, "plan", "archive"), { recursive: true });
  return { root, specsDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function writeFR(specsDir: string, filename: string, tracker: { key: string; id: string } | null, milestone: string): void {
  const trackerBlock = tracker ? `tracker:\n  ${tracker.key}: ${tracker.id}\n` : "tracker: {}\n";
  const body = `---\ntitle: Test FR\nmilestone: ${milestone}\nstatus: active\narchived_at: null\n${trackerBlock}created_at: 2026-05-13T00:00:00Z\n---\n\n# ${filename}\n`;
  writeFileSync(join(specsDir, "frs", filename), body);
}

function writePlan(specsDir: string, milestone: string): void {
  const body = `---\nmilestone: ${milestone}\nstatus: active\narchived_at: null\n---\n\n# ${milestone} — Test plan\n`;
  writeFileSync(join(specsDir, "plan", `${milestone}.md`), body);
}

describe("AC-STE-284.4: clean-sync → no violations", () => {
  test("tracker IDs match local + milestones match → empty violations, no severity escalation", async () => {
    const ctx = makeProject();
    try {
      writeFR(ctx.specsDir, "STE-1.md", { key: "linear", id: "STE-1" }, "M70");
      writeFR(ctx.specsDir, "STE-2.md", { key: "linear", id: "STE-2" }, "M70");
      writePlan(ctx.specsDir, "M70");
      const provider = new StubTrackerProvider(["STE-1", "STE-2"], [{ name: "M70" }]);
      const r = await runTrackerLocalReconciliationDriftProbe(ctx.root, { provider });
      expect(r.violations).toEqual([]);
      // No hard collision → severity must not be 'error'.
      expect(r.severity === "error").toBe(false);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-284.4: drift → severity warning, ≥ 1 violation", () => {
  test("tracker-orphan STE-99 + missing local FR → warning with one note", async () => {
    const ctx = makeProject();
    try {
      writePlan(ctx.specsDir, "M70");
      const provider = new StubTrackerProvider(["STE-99"], [{ name: "M70" }]);
      const r = await runTrackerLocalReconciliationDriftProbe(ctx.root, { provider });
      expect(r.violations.length).toBeGreaterThanOrEqual(1);
      expect(r.severity).toBe("warning");
      // One of the violation notes should mention the orphan tracker ID.
      expect(r.violations.some((v) => v.note.includes("STE-99"))).toBe(true);
    } finally {
      ctx.cleanup();
    }
  });

  test("milestone mismatch alone → severity warning", async () => {
    const ctx = makeProject();
    try {
      const provider = new StubTrackerProvider([], [{ name: "M70" }]);
      const r = await runTrackerLocalReconciliationDriftProbe(ctx.root, { provider });
      expect(r.violations.length).toBeGreaterThanOrEqual(1);
      expect(r.severity).toBe("warning");
      expect(r.violations.some((v) => v.note.includes("M70"))).toBe(true);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-284.4: hard collisions → severity error", () => {
  test("same tracker ID bound to two local files → error", async () => {
    const ctx = makeProject();
    try {
      // Two distinct local files both claim binding linear:STE-1.
      writeFR(ctx.specsDir, "STE-1.md", { key: "linear", id: "STE-1" }, "M70");
      writeFR(ctx.specsDir, "DUPLICATE.md", { key: "linear", id: "STE-1" }, "M70");
      writePlan(ctx.specsDir, "M70");
      const provider = new StubTrackerProvider(["STE-1"], [{ name: "M70" }]);
      const r = await runTrackerLocalReconciliationDriftProbe(ctx.root, { provider });
      expect(r.severity).toBe("error");
      // The violation note must surface the duplicated tracker ID.
      expect(r.violations.some((v) => v.note.includes("STE-1"))).toBe(true);
    } finally {
      ctx.cleanup();
    }
  });

  test("local FR points to non-existent tracker ID → error", async () => {
    const ctx = makeProject();
    try {
      writeFR(ctx.specsDir, "STE-GHOST.md", { key: "linear", id: "STE-9999" }, "M70");
      writePlan(ctx.specsDir, "M70");
      // Tracker has no FRs and no milestones matching → STE-9999 binding is dangling.
      const provider = new StubTrackerProvider([], [{ name: "M70" }]);
      const r = await runTrackerLocalReconciliationDriftProbe(ctx.root, { provider });
      expect(r.severity).toBe("error");
      expect(r.violations.some((v) => v.note.includes("STE-9999"))).toBe(true);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-284.4: probe is registered in gate-check SKILL.md", () => {
  test("SKILL.md mentions `tracker_local_reconciliation_drift` probe by name", async () => {
    const skillPath = join(import.meta.dir, "..", "skills", "gate-check", "SKILL.md");
    const { readFileSync } = await import("node:fs");
    const body = readFileSync(skillPath, "utf-8");
    expect(body).toContain("tracker_local_reconciliation_drift");
  });
});

// ===========================================================================
// STE-605 — probe #49 becomes the detector.
// ===========================================================================

let ste605Manifest = "";
let ste605Scratch = "";
const STE605_SESSION = `ste605-drift-${process.pid}`;

beforeAll(() => {
  ste605Manifest = mkdtempSync(join(tmpdir(), "dpt-ste605-drift-manifest-"));
  pluginManifest(ste605Manifest, "2.87.0");
  ste605Scratch = mkdtempSync(join(tmpdir(), "dpt-ste605-drift-pages-"));
});

afterAll(() => {
  rmSync(ste605Manifest, { recursive: true, force: true });
  rmSync(ste605Scratch, { recursive: true, force: true });
});

let ste605PageSeq = 0;
function ste605Page(page: unknown): string {
  ste605PageSeq += 1;
  const p = join(ste605Scratch, `page-${ste605PageSeq}.json`);
  writeFileSync(p, JSON.stringify(page));
  return p;
}

function runProbeFrontDoor(root: string, pages: string[]): Run {
  const run = spawnModule(DRIFT_MODULE, [root, ...pages], {
    CLAUDE_PLUGIN_ROOT: ste605Manifest,
    CLAUDE_CODE_SESSION_ID: STE605_SESSION,
  });
  expect(run.stderr).not.toMatch(/TypeError|ReferenceError|SyntaxError|Cannot find module/);
  return run;
}

/** A run that read pages: its `excluded` info row proves the probe ran. */
function ranOverPages(run: Run): string {
  expect(run.stdout, `probe produced no excluded-count info row\nstderr=${run.stderr}`).toMatch(/excluded/);
  return run.stdout;
}

async function withTwoRoots(body: (fe: string, be: string) => void | Promise<void>): Promise<void> {
  const fx = makeSpanFixture("M_GF_85");
  try {
    await body(fx.a, fx.b);
  } finally {
    fx.cleanup();
  }
}

const TRACKER_ORPHAN = "tracker-orphan";
const UNOWNED_ROW = "unowned-container-ticket";
const UNTAGGED_ROW = "bound-ticket-untagged";
const NUMERIC_ROW = "numeric-milestone-shared";

describe("AC-STE-605.6: probe #49 front door over shared pages", () => {
  test("tracker-orphan rows appear only for ours and unowned, each naming class and owner", async () => {
    await withTwoRoots((fe) => {
      declareJira(fe, FE_TAG);
      boundFr(fe, "GF-101");
      const out = ranOverPages(runProbeFrontDoor(fe, [ste605Page(jiraPage(TWO_REPO))]));
      expect(probeRowKeys(out, TRACKER_ORPHAN)).toEqual(["GF-102", "GF-121", "GF-122", "GF-131"]);
      const rowOf = (k: string) => probeRows(out, TRACKER_ORPHAN).find((l) => l.includes(k)) ?? "";
      expect(rowOf("GF-102")).toContain("ours");
      expect(rowOf("GF-102")).toContain("Fe Dev");
      expect(rowOf("GF-121")).toContain("unowned");
      expect(rowOf("GF-121")).toContain("Pat Manager");
    });
  });

  test("shared: an unowned-container-ticket row per unowned, non-container ticket, naming its creator", async () => {
    await withTwoRoots((fe) => {
      declareJira(fe, FE_TAG);
      const out = ranOverPages(runProbeFrontDoor(fe, [ste605Page(jiraPage(TWO_REPO))]));
      expect(probeRowKeys(out, UNOWNED_ROW)).toEqual(["GF-121", "GF-122", "GF-131"]);
      const rowOf = (k: string) => probeRows(out, UNOWNED_ROW).find((l) => l.includes(k)) ?? "";
      expect(rowOf("GF-122")).toContain("Quinn Support");
      expect(rowOf("GF-122")).toContain("Typo on paywall");
    });
  });

  test("shared: a bound ticket lacking this repository's tag is a bound-ticket-untagged row", async () => {
    await withTwoRoots((fe) => {
      declareJira(fe, FE_TAG);
      boundFr(fe, "GF-101"); // tagged: no row
      boundFr(fe, "GF-121"); // untagged: row
      const out = ranOverPages(runProbeFrontDoor(fe, [ste605Page(jiraPage(TWO_REPO))]));
      expect(probeRowKeys(out, UNTAGGED_ROW)).toEqual(["GF-121"]);
      expect(probeRows(out, UNTAGGED_ROW)[0]).toContain(FE_TAG);
    });
  });

  test("undeclared: the same page and bindings yield no unowned-container-ticket and no bound-ticket-untagged row", async () => {
    await withTwoRoots((fe) => {
      declareJira(fe, null);
      boundFr(fe, "GF-121");
      const out = ranOverPages(runProbeFrontDoor(fe, [ste605Page(jiraPage(TWO_REPO))]));
      expect(probeRows(out, UNOWNED_ROW)).toEqual([]);
      expect(probeRows(out, UNTAGGED_ROW)).toEqual([]);
      // Positive control: the undeclared listing still reports its orphans, containers excluded.
      expect(probeRowKeys(out, TRACKER_ORPHAN)).toContain("GF-111");
      expect(probeRowKeys(out, TRACKER_ORPHAN)).not.toContain("GF-85");
    });
  });

  test("container-not-read: no page supplied is a named skip, never a silent green", async () => {
    await withTwoRoots((fe) => {
      declareJira(fe, FE_TAG);
      const run = runProbeFrontDoor(fe, []);
      expect(run.stdout).toContain("container-not-read");
      expect(run.stdout).not.toContain("container-empty");
    });
  });

  test("container-empty: an empty, complete page is an info row", async () => {
    await withTwoRoots((fe) => {
      declareJira(fe, FE_TAG);
      const run = runProbeFrontDoor(fe, [ste605Page({ issues: [], isLast: true })]);
      expect(run.stdout).toContain("container-empty");
      expect(run.stdout).not.toContain("container-partial");
      expect(run.stdout).not.toContain("container-not-read");
    });
  });

  test("container-partial: an incomplete page set is a warning", async () => {
    await withTwoRoots((fe) => {
      declareJira(fe, FE_TAG);
      const run = runProbeFrontDoor(fe, [ste605Page(jiraPage(TWO_REPO, false))]);
      expect(run.stdout).toContain("container-partial");
      expect(run.stdout).not.toContain("container-empty");
    });
  });

  test("CONTROL: a complete, non-empty page yields none of the three outcome rows", async () => {
    await withTwoRoots((fe) => {
      declareJira(fe, FE_TAG);
      const out = ranOverPages(runProbeFrontDoor(fe, [ste605Page(jiraPage(TWO_REPO))]));
      for (const k of ["container-not-read", "container-empty", "container-partial"]) expect(out).not.toContain(k);
    });
  });

  test("the probe calls no mutator: the tree is byte-identical after a shared run (no import, no receipt)", async () => {
    await withTwoRoots((fe) => {
      declareJira(fe, FE_TAG);
      boundFr(fe, "GF-121");
      const before = snapshotTree(fe);
      ranOverPages(runProbeFrontDoor(fe, [ste605Page(jiraPage(TWO_REPO))]));
      expect(snapshotTree(fe)).toEqual(before);
    });
  });
});

describe("AC-STE-605.10: old clients and people appear in BOTH repositories' probe output", () => {
  test("the back-linked unlabelled ticket and a hand-filed one are unowned-container-ticket rows in FE and BE, naming the creator", async () => {
    await withTwoRoots((fe, be) => {
      declareJira(fe, FE_TAG);
      declareJira(be, BE_TAG);
      const page = ste605Page(jiraPage(TWO_REPO));
      for (const root of [fe, be]) {
        const out = ranOverPages(runProbeFrontDoor(root, [page]));
        const rows = probeRows(out, UNOWNED_ROW);
        expect(rows.find((l) => l.includes("GF-131")) ?? "").toContain("Old Client");
        expect(rows.find((l) => l.includes("GF-121")) ?? "").toContain("Pat Manager");
      }
    });
  });
});

describe("AC-STE-605.7: undeclared — an Epic is the only difference", () => {
  test("with the container page, the Epic is no longer a tracker orphan and nothing else moves", async () => {
    const ctx = makeProject();
    try {
      claudeMd(ctx.root, { mode: "jira", project: "GF" });
      writeFR(ctx.specsDir, "GF-1.md", { key: "jira", id: "GF-1" }, "M70");
      writePlan(ctx.specsDir, "M70");
      const tickets: Ticket[] = [
        { key: "GF-1", title: "Bound", labels: [], creator: "Fe Dev", backLink: true },
        { key: "GF-2", title: "M_GF_2 Epic", labels: [], type: "Epic", creator: "Lead" },
        { key: "GF-3", title: "Orphan", labels: [], creator: "Pat Manager" },
      ];
      const provider = new StubTrackerProvider(["GF-1", "GF-2", "GF-3"], [{ name: "M70" }]);
      const sig = (v: { kind: string; severity: string; note: string }) =>
        `${v.kind}|${v.severity}|${(v.note.match(/\bGF-\d+\b/g) ?? []).sort().join(",")}`;
      const without = await runTrackerLocalReconciliationDriftProbe(ctx.root, { provider });
      const withPages = await runTrackerLocalReconciliationDriftProbe(ctx.root, {
        provider,
        containerPages: [jiraPage(tickets)],
      } as never);
      const before = without.violations.map(sig).sort();
      expect(before).toContain("tracker-orphan|warning|GF-2");
      expect(withPages.violations.map(sig).sort()).toEqual(before.filter((s) => s !== "tracker-orphan|warning|GF-2"));
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-605.12: numeric-label collision (LJ-1)", () => {
  const t = (key: string, labels: string[], creator = "Someone"): Ticket => ({
    key,
    title: `Ticket ${key}`,
    labels,
    creator,
    backLink: true,
  });
  const TWO_REPO_M8 = [t("GF-201", [FE_TAG, "milestone-M8"]), t("GF-202", [BE_TAG, "milestone-M8"])];

  test("FE and BE each yield exactly one numeric-milestone-shared warning naming the label and both keys; no mutator", async () => {
    await withTwoRoots((fe, be) => {
      declareJira(fe, FE_TAG);
      declareJira(be, BE_TAG);
      const page = ste605Page(jiraPage(TWO_REPO_M8));
      for (const root of [fe, be]) {
        const before = snapshotTree(root);
        const out = ranOverPages(runProbeFrontDoor(root, [page]));
        const rows = out.split("\n").filter((l) => l.includes(NUMERIC_ROW));
        expect(rows.length, out).toBe(1);
        expect(rows[0]).toContain("milestone-M8");
        expect(rows[0]).toContain("GF-201");
        expect(rows[0]).toContain("GF-202");
        expect(rows[0]).toMatch(/mix/i);
        expect(snapshotTree(root)).toEqual(before);
      }
    });
  });

  const twins: { name: string; tickets: Ticket[]; undeclared?: boolean }[] = [
    {
      name: "milestone-M8 on two tickets of one repository",
      tickets: [t("GF-201", [FE_TAG, "milestone-M8"]), t("GF-203", [FE_TAG, "milestone-M8"])],
    },
    {
      name: "milestone-M8 on one tagged ticket and one unowned ticket",
      tickets: [t("GF-201", [FE_TAG, "milestone-M8"]), t("GF-204", ["milestone-M8"], "Pat Manager")],
    },
    {
      name: "a tracker-keyed milestone-M_GF_85 label on both repositories' tickets",
      tickets: [t("GF-205", [FE_TAG, "milestone-M_GF_85"]), t("GF-206", [BE_TAG, "milestone-M_GF_85"])],
    },
    { name: "the two-repository page in an undeclared repository", tickets: TWO_REPO_M8, undeclared: true },
    // Stage C hardening (AUDIT advisory): one sibling repository whose tickets
    // differ only by a generic label (`bug`) is still ONE repository — keyed on
    // the joined label set it read as two and warned falsely in FE.
    {
      name: "milestone-M8 on two tickets of ONE sibling, one also carrying a generic label",
      tickets: [t("GF-207", [BE_TAG, "milestone-M8"]), t("GF-208", [BE_TAG, "bug", "milestone-M8"])],
    },
  ];

  for (const twin of twins) {
    test(`PERMIT: ${twin.name} — no numeric-milestone-shared warning in either repository`, async () => {
      await withTwoRoots((fe, be) => {
        declareJira(fe, twin.undeclared ? null : FE_TAG);
        declareJira(be, twin.undeclared ? null : BE_TAG);
        const page = ste605Page(jiraPage(twin.tickets));
        for (const root of [fe, be]) {
          const out = ranOverPages(runProbeFrontDoor(root, [page]));
          expect(out.split("\n").filter((l) => l.includes(NUMERIC_ROW))).toEqual([]);
        }
      });
    });
  }
});
