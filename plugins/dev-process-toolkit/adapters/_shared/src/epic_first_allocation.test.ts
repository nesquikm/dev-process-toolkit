// STE-377 — Epic-first milestone allocation in /spec-write (claim-on-create).
//
// Covers the deterministic helper legs of AC-STE-377.1–.5:
//   .1 `milestoneIdFromEpicKey(key)` sanitizer (colocated with the STE-376
//      union grammar in milestone_token.ts): `PROJ-500` → `M_PROJ_500`,
//      round-trips with the union matcher; the epic-binding attach surfaces
//      the tracker-assigned Epic key so /spec-write can derive the id.
//   .2 collision-free by construction: two allocations against distinct
//      Epic keys yield distinct `M_<epic-key>` ids with no lock/retry and
//      no sequential-scan ops on the Jira path.
//   .3 FR binding + self-describing membership: Task `parent` = Epic key,
//      `milestone: M_<epic-key>` frontmatter is a first-class milestone
//      binding, and the id re-derives from its own parent key.
//   .4 Linear + mode:none unchanged: `nextFreeMilestoneNumber` five-way
//      scan stays sequential (`M_<key>` tokens excluded, STE-376) and no
//      Epic is created off the Jira path.
//   .5 plan file at `specs/plan/M_<epic-key>.md` with a canonical
//      `# M_<epic-key> — <title>` heading that parses (STE-376) and that
//      /ship-milestone can later stamp (`stampShippedIn`).

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  attachProjectMilestone,
  planFileHeadingToMilestoneName,
  type MilestoneOps,
} from "./attach_project_milestone";
import { runFrontmatterMilestoneNotArchivedProbe } from "./frontmatter_milestone_not_archived";
import {
  isMilestoneToken,
  milestoneIdFromEpicKey,
  parseMilestoneToken,
  PLAN_FILENAME_RE,
} from "./milestone_token";
import { nextFreeMilestoneNumber } from "./next_free_milestone_number";
import { stampShippedIn } from "./plan_ship_stamp";

// ───────────────────────────────────────────────────────────────────────
// Fixtures
// ───────────────────────────────────────────────────────────────────────

// The attach result under STE-377 carries the tracker-assigned Epic key.
// Cast keeps this file compiling against the pre-STE-377 result type
// (capability/createdName only); the epicKey assertions fail RED, not
// TypeErrors — same pattern as the STE-375 epic-branch tests.
type EpicFirstAttachResult = {
  capability: string | null;
  createdName?: string;
  epicKey?: string;
};

const attachEpic = attachProjectMilestone as unknown as (
  provider: unknown,
  project: string,
  milestoneName: string,
  ticketId: string,
  opts?: { sleep?: (ms: number) => Promise<void> },
) => Promise<EpicFirstAttachResult>;

interface EpicStub {
  epics: { key: string; name: string }[];
  /** The FR Task's current parent Epic key (null = unparented). */
  parent: string | null;
  calls: string[];
  /** Tracker-assigned key minted for the next createEpic call. */
  nextEpicKey: string;
}

function baseEpicStub(overrides: Partial<EpicStub> = {}): EpicStub {
  return { epics: [], parent: null, calls: [], nextEpicKey: "PROJ-500", ...overrides };
}

function makeEpicProvider(stub: EpicStub): Record<string, unknown> {
  return {
    milestoneBinding: "epic" as const,
    async listEpics(project: string): Promise<{ key: string; name: string }[]> {
      stub.calls.push(`listEpics(${project})`);
      return stub.epics.map((e) => ({ ...e }));
    },
    async createEpic(project: string, opts: { name: string }): Promise<{ key: string }> {
      stub.calls.push(`createEpic(${project},${opts.name})`);
      stub.epics.push({ key: stub.nextEpicKey, name: opts.name });
      return { key: stub.nextEpicKey };
    },
    async setParent(ticketId: string, epicKey: string): Promise<void> {
      stub.calls.push(`setParent(${ticketId},${epicKey})`);
      stub.parent = epicKey;
    },
    async getIssue(ticketId: string): Promise<{
      projectMilestone: { name: string } | null;
      parent: string | null;
      labels: string[];
    }> {
      stub.calls.push(`getIssue(${ticketId})`);
      return { projectMilestone: null, parent: stub.parent, labels: [] };
    },
    // Sequential-scan / object-path ops must never fire on the Jira
    // Epic-first path (AC-STE-377.2) — record, then throw loudly.
    async listMilestones(): Promise<{ name: string }[]> {
      stub.calls.push("listMilestones");
      throw new Error("Epic-first Jira path must not run the sequential scan (listMilestones)");
    },
    async saveMilestone(): Promise<void> {
      stub.calls.push("saveMilestone");
      throw new Error("Epic-first Jira path must not call saveMilestone");
    },
    async upsertTicketMetadata(): Promise<string> {
      stub.calls.push("upsertTicketMetadata");
      throw new Error("Epic-first Jira path must not call upsertTicketMetadata");
    },
  };
}

function sleepRecorder(): { sleeps: number[]; sleep: (ms: number) => Promise<void> } {
  const sleeps: number[] = [];
  return {
    sleeps,
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
  };
}

// ───────────────────────────────────────────────────────────────────────
// AC-STE-377.1 — Epic-first, key-derived id
// ───────────────────────────────────────────────────────────────────────

describe("AC-STE-377.1 — milestoneIdFromEpicKey sanitizer", () => {
  test("PROJ-500 → M_PROJ_500 (hyphen sanitized to underscore)", () => {
    expect(milestoneIdFromEpicKey("PROJ-500")).toBe("M_PROJ_500");
  });

  test("DST-49 → M_DST_49", () => {
    expect(milestoneIdFromEpicKey("DST-49")).toBe("M_DST_49");
  });

  test("output is filesystem/label-safe ([A-Za-z0-9_] only after the M_ prefix)", () => {
    expect(milestoneIdFromEpicKey("PROJ-500")).toMatch(/^M_[A-Za-z0-9_]+$/);
  });

  test("round-trips with the union matcher: parses as an epic token", () => {
    const id = milestoneIdFromEpicKey("PROJ-500");
    expect(isMilestoneToken(id)).toBe(true);
    expect(parseMilestoneToken(id)).toEqual({ kind: "epic", key: "PROJ_500" });
  });

  test("re-deriving from the parsed key is stable (sanitizer idempotent)", () => {
    const id = milestoneIdFromEpicKey("PROJ-500");
    const parsed = parseMilestoneToken(id);
    expect(parsed?.kind).toBe("epic");
    expect(milestoneIdFromEpicKey((parsed as { kind: "epic"; key: string }).key)).toBe(id);
  });

  test("empty key throws — a bare `M_` would be malformed under the union grammar", () => {
    expect(() => milestoneIdFromEpicKey("")).toThrow();
  });
});

describe("AC-STE-377.1 — epic-binding attach surfaces the Epic key for id derivation", () => {
  const EPIC_NAME = "Epic-first allocation fixture"; // pre-key title: the key does not exist yet

  test("create path: tracker-assigned key surfaced on the result", async () => {
    const stub = baseEpicStub({ nextEpicKey: "PROJ-500" });
    const rec = sleepRecorder();
    const result = await attachEpic(makeEpicProvider(stub), "PROJ", EPIC_NAME, "PROJ-501", {
      sleep: rec.sleep,
    });
    expect(result.capability).toBe("milestone_create_required");
    expect(result.epicKey).toBe("PROJ-500");
    // /spec-write derives the milestone id from the surfaced key alone —
    // no scan, no plan file needed first.
    expect(milestoneIdFromEpicKey(result.epicKey!)).toBe("M_PROJ_500");
  });

  test("found path: existing Epic's key surfaced too", async () => {
    const stub = baseEpicStub({ epics: [{ key: "PROJ-500", name: EPIC_NAME }] });
    const rec = sleepRecorder();
    const result = await attachEpic(makeEpicProvider(stub), "PROJ", EPIC_NAME, "PROJ-501", {
      sleep: rec.sleep,
    });
    expect(result.capability).toBeNull();
    expect(result.epicKey).toBe("PROJ-500");
  });

  test("already-bound idempotent no-op still surfaces the key", async () => {
    const stub = baseEpicStub({
      epics: [{ key: "PROJ-500", name: EPIC_NAME }],
      parent: "PROJ-500",
    });
    const rec = sleepRecorder();
    const result = await attachEpic(makeEpicProvider(stub), "PROJ", EPIC_NAME, "PROJ-501", {
      sleep: rec.sleep,
    });
    expect(result.capability).toBeNull();
    expect(result.epicKey).toBe("PROJ-500");
  });
});

// ───────────────────────────────────────────────────────────────────────
// AC-STE-377.2 — collision-free by construction
// ───────────────────────────────────────────────────────────────────────

describe("AC-STE-377.2 — two concurrent Jira allocations never collide", () => {
  test("distinct tracker keys ⇒ distinct M_<epic-key> ids; no scan, no lock, no retry", async () => {
    const stubA = baseEpicStub({ nextEpicKey: "PROJ-500" });
    const stubB = baseEpicStub({ nextEpicKey: "PROJ-501" });
    const recA = sleepRecorder();
    const recB = sleepRecorder();

    const [resultA, resultB] = await Promise.all([
      attachEpic(makeEpicProvider(stubA), "PROJ", "Concurrent milestone A", "PROJ-510", {
        sleep: recA.sleep,
      }),
      attachEpic(makeEpicProvider(stubB), "PROJ", "Concurrent milestone B", "PROJ-511", {
        sleep: recB.sleep,
      }),
    ]);

    const idA = milestoneIdFromEpicKey(resultA.epicKey!);
    const idB = milestoneIdFromEpicKey(resultB.epicKey!);
    expect(idA).toBe("M_PROJ_500");
    expect(idB).toBe("M_PROJ_501");
    expect(idA).not.toBe(idB);

    // nextFreeMilestoneNumber never runs on the Jira path: none of the
    // sequential-scan / object-path ops fire on either allocation.
    for (const stub of [stubA, stubB]) {
      expect(stub.calls).not.toContain("listMilestones");
      expect(stub.calls).not.toContain("saveMilestone");
      expect(stub.calls).not.toContain("upsertTicketMetadata");
    }
    // No lock/reconcile/retry: the happy allocation path waits zero times.
    expect(recA.sleeps).toEqual([]);
    expect(recB.sleeps).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────
// AC-STE-377.3 — FR binding + self-describing membership
// ───────────────────────────────────────────────────────────────────────

describe("AC-STE-377.3 — FR binding + self-describing membership", () => {
  test("Task parented to the Epic; milestone id re-derives from its own parent key", async () => {
    const stub = baseEpicStub({
      epics: [{ key: "DST-42", name: "M_DST_42 — Epic-keyed milestone example" }],
    });
    const rec = sleepRecorder();
    const result = await attachEpic(
      makeEpicProvider(stub),
      "DST",
      "M_DST_42 — Epic-keyed milestone example",
      "DST-77",
      { sleep: rec.sleep },
    );
    // Membership is queryable as `parent = <epic-key>`.
    expect(stub.calls).toContain("setParent(DST-77,DST-42)");
    expect(stub.parent).toBe("DST-42");
    // The surfaced key and the milestone id encode each other: the FR's
    // `milestone:` frontmatter value re-derives from the parent key alone.
    expect(result.epicKey).toBe("DST-42");
    expect(milestoneIdFromEpicKey(result.epicKey!)).toBe("M_DST_42");
  });

  test("`milestone: M_<epic-key>` frontmatter is a first-class milestone binding (hygiene probe passes)", async () => {
    const root = mkdtempSync(join(tmpdir(), "ste377-frontmatter-"));
    try {
      mkdirSync(join(root, "specs", "frs"), { recursive: true });
      mkdirSync(join(root, "specs", "plan"), { recursive: true });
      writeFileSync(
        join(root, "specs", "frs", "DST-77.md"),
        [
          "---",
          "title: Epic-keyed FR fixture",
          "milestone: M_DST_42",
          "status: active",
          "---",
          "",
          "# DST-77: Epic-keyed FR fixture {#DST-77}",
          "",
        ].join("\n"),
      );
      writeFileSync(
        join(root, "specs", "plan", "M_DST_42.md"),
        "# M_DST_42 — Epic-keyed milestone example\n",
      );
      const report = await runFrontmatterMilestoneNotArchivedProbe(root);
      expect(report.violations).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ───────────────────────────────────────────────────────────────────────
// AC-STE-377.4 — Linear + mode:none unchanged
// ───────────────────────────────────────────────────────────────────────

describe("AC-STE-377.4 — Linear + mode:none milestone allocation is byte-unchanged", () => {
  function makeScanFixture(): { specs: string; changelog: string; cleanup: () => void } {
    const root = mkdtempSync(join(tmpdir(), "ste377-scan-"));
    const specs = join(root, "specs");
    mkdirSync(join(specs, "plan", "archive"), { recursive: true });
    writeFileSync(join(specs, "plan", "M101.md"), "# M101 — Sequential milestone\n");
    writeFileSync(
      join(specs, "plan", "M_PROJ_500.md"),
      "# M_PROJ_500 — Epic-keyed milestone\n",
    );
    writeFileSync(join(specs, "plan", "archive", "M99.md"), "# M99 — Archived milestone\n");
    const changelog = join(root, "CHANGELOG.md");
    writeFileSync(
      changelog,
      "# Changelog\n\nM100 shipped.\nM_PROJ_777 is an Epic-keyed milestone ref.\n",
    );
    return { specs, changelog, cleanup: () => rmSync(root, { recursive: true, force: true }) };
  }

  test("five-way scan stays sequential: M_<key> tokens excluded from every source", async () => {
    const fx = makeScanFixture();
    try {
      const provider = {
        listMilestones: async () => [
          { name: "M97 — Labeled" },
          { name: "M_PROJ_777 — Epic-keyed" },
        ],
      };
      const r = await nextFreeMilestoneNumber(fx.specs, fx.changelog, provider);
      expect(r.next).toBe(102);
      expect(r.sources.active).toEqual([101]); // M_PROJ_500.md excluded
      expect(r.sources.archived).toEqual([99]);
      expect(r.sources.changelog).toEqual([100]); // M_PROJ_777 excluded
      expect(r.sources.tracker).toEqual([97]); // M_PROJ_777 excluded
      expect(r.sources.branches).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("mode:none (no provider, no branchScanner) keeps the sequential path", async () => {
    const fx = makeScanFixture();
    try {
      const r = await nextFreeMilestoneNumber(fx.specs, fx.changelog);
      expect(r.next).toBe(102);
      expect(r.sources.tracker).toEqual([]);
      expect(r.sources.branches).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("a specs tree holding ONLY epic-keyed plans allocates from M1", async () => {
    const root = mkdtempSync(join(tmpdir(), "ste377-epic-only-"));
    try {
      const specs = join(root, "specs");
      mkdirSync(join(specs, "plan"), { recursive: true });
      writeFileSync(
        join(specs, "plan", "M_PROJ_500.md"),
        "# M_PROJ_500 — Epic-keyed milestone\n",
      );
      const r = await nextFreeMilestoneNumber(specs);
      expect(r.next).toBe(1);
      expect(r.sources.active).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("no Epic is created off the Jira path: object binding never touches createEpic", async () => {
    const MILESTONE_NAME = "M102 — Sequential milestone";
    const calls: string[] = [];
    const provider: MilestoneOps = {
      async listMilestones() {
        calls.push("listMilestones");
        return [{ name: MILESTONE_NAME }];
      },
      async saveMilestone() {
        calls.push("saveMilestone");
      },
      async upsertTicketMetadata() {
        calls.push("upsertTicketMetadata");
        return "STE-901";
      },
      async getIssue() {
        calls.push("getIssue");
        return { projectMilestone: { name: MILESTONE_NAME } };
      },
      createEpic: async () => {
        calls.push("createEpic");
        return { key: "NEVER-1" };
      },
    };
    const result = await attachProjectMilestone(provider, "DPT", MILESTONE_NAME, "STE-901");
    expect(result.capability).toBeNull();
    expect(calls).toContain("upsertTicketMetadata"); // object path unchanged
    expect(calls).not.toContain("createEpic");
  });
});

// ───────────────────────────────────────────────────────────────────────
// AC-STE-377.5 — plan file + ship-ready
// ───────────────────────────────────────────────────────────────────────

describe("AC-STE-377.5 — plan file at specs/plan/M_<epic-key>.md is parseable + stampable", () => {
  test("PLAN_FILENAME_RE accepts the derived plan filename (and rejects bare M_)", () => {
    expect(PLAN_FILENAME_RE.test(`${milestoneIdFromEpicKey("PROJ-500")}.md`)).toBe(true);
    expect(PLAN_FILENAME_RE.test("M_.md")).toBe(false);
  });

  test("derived id → plan file → canonical heading parse → /ship-milestone stamp", async () => {
    const root = mkdtempSync(join(tmpdir(), "ste377-plan-"));
    try {
      const id = milestoneIdFromEpicKey("DST-42");
      expect(id).toBe("M_DST_42");
      const planDir = join(root, "specs", "plan");
      mkdirSync(planDir, { recursive: true });
      const planPath = join(planDir, `${id}.md`);
      writeFileSync(
        planPath,
        [
          "---",
          "status: active",
          "shipped_in: null",
          "---",
          "",
          `# ${id} — Epic-keyed milestone example`,
          "",
          "Body.",
          "",
        ].join("\n"),
      );
      // STE-376 heading grammar parses the canonical `# M_<epic-key> — <title>`.
      expect(planFileHeadingToMilestoneName(planPath)).toBe(
        "M_DST_42 — Epic-keyed milestone example",
      );
      // /ship-milestone can later stamp it (async — await before re-read).
      await stampShippedIn(planPath, "2.55.0");
      expect(readFileSync(planPath, "utf-8")).toContain("shipped_in: v2.55.0");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
