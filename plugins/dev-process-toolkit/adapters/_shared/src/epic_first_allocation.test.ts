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
//   .4 Linear unchanged: `nextFreeMilestoneNumber` five-way scan stays
//      sequential (`M_<key>` tokens excluded, STE-376) and no Epic is
//      created off the Jira path. RE-SCOPED by STE-417 (AC-STE-417.5):
//      `mode: none` no longer rides this arm — it mints an opaque
//      ULID-derived id and bypasses the scan entirely. That divergence is
//      DELIBERATE, not drift: STE-377 declined tracker-less minting on the
//      premise that no key was available to claim from, and STE-417
//      overturns that call because `Provider.mintId()` supplies exactly
//      such a key. The `mode: none` arm below therefore asserts the
//      minted path, including that the scan is NOT reachable from it.
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
import { mintMilestoneEpic } from "./mint_milestone_epic";
import { runFrontmatterMilestoneNotArchivedProbe } from "./frontmatter_milestone_not_archived";
import {
  isMilestoneToken,
  milestoneIdFromEpicKey,
  milestoneIdFromUlid,
  parseMilestoneToken,
  PLAN_FILENAME_RE,
} from "./milestone_token";
import { mintMilestoneId } from "./mint_milestone_id";
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

  // STE-522 re-point: the CREATE path moved out of the attach into
  // `mintMilestoneEpic`. That was structural, not cosmetic —
  // `attachProjectMilestone` takes `ticketId` as a REQUIRED positional, so
  // minting inside it demanded a ticket that, on the Epic-first path, does
  // not exist yet. The helper takes no ticket. This test's subject is
  // unchanged: the tracker-assigned key is surfaced for id derivation.
  test("create path: tracker-assigned key surfaced on the result", async () => {
    const stub = baseEpicStub({ nextEpicKey: "PROJ-500" });
    const result = await mintMilestoneEpic(makeEpicProvider(stub) as never, "PROJ", EPIC_NAME);
    expect(result.epicKey).toBe("PROJ-500");
    // /spec-write derives the milestone id from the surfaced key alone —
    // no scan, no plan file needed first.
    expect(result.milestoneId).toBe("M_PROJ_500");
    expect(milestoneIdFromEpicKey(result.epicKey)).toBe("M_PROJ_500");
    // The summary sent is the TITLE ALONE — the canonical `M_<key> — <title>`
    // name is not computable here, which is the whole reason this step exists.
    expect(stub.calls).toContain(`createEpic(PROJ,${EPIC_NAME})`);
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

    // STE-522 re-point: allocation is `mintMilestoneEpic` now (see AC-377.1).
    const [resultA, resultB] = await Promise.all([
      mintMilestoneEpic(makeEpicProvider(stubA) as never, "PROJ", "Concurrent milestone A"),
      mintMilestoneEpic(makeEpicProvider(stubB) as never, "PROJ", "Concurrent milestone B"),
    ]);

    // Asserted through the helper's OWN derivation and re-derived independently,
    // so a helper that returned a stale or shared id fails the first line.
    expect(resultA.milestoneId).toBe("M_PROJ_500");
    expect(resultB.milestoneId).toBe("M_PROJ_501");
    const idA = milestoneIdFromEpicKey(resultA.epicKey);
    const idB = milestoneIdFromEpicKey(resultB.epicKey);
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
// AC-STE-377.4 — RETIRED by M139/STE-541 (AC-STE-541.6).
//
// STE-377 pinned "Linear AND mode: none milestone allocation byte-unchanged".
// AC-STE-417.5 re-scoped the tracker-less half out; M139 retires the Linear
// half that survived it, by name, in `specs/plan/M139.md`.
//
// THE BEHAVIOURAL CHANGE: `mode: linear` no longer resolves an identity
// OFFLINE. The sequential scan needed no tracker; `mintMilestoneLinear`
// requires a provider carrying the milestone-create op, because an identity
// derived from a tracker object cannot be computed without the tracker. Linear
// therefore no longer routes through `nextFreeMilestoneNumber` at all, so
// "Linear milestone allocation is unchanged" is not a claim this file can make.
//
// REPLACEMENT, named here rather than dropped: the Linear branch's behaviour is
// owned by `tests/m139-ste-541-linear-minted-milestone.test.ts` (AC-STE-541.1 —
// mint equality plus a zero call count on an injected scanner double) and by
// `tests/m119-ste-440-milestone-identity-dispatcher.test.ts` (AC-STE-440.3 —
// the dispatcher equals `mintMilestoneLinear`'s own derivation).
//
// WHAT SURVIVES HERE, retargeted rather than deleted: the sequential
// allocator's OWN exclusion contract — `M_<key>` tokens must not be read as
// numbers by any of its five sources. That contract is untouched by this FR,
// and the allocator still owns the explicitly-typed `M<N>` collision check, so
// deleting these legs would lose live coverage of a live surface.
// ───────────────────────────────────────────────────────────────────────

describe("AC-STE-377.4 RETIRED (M139/STE-541) — the allocator's M_<key> exclusion survives", () => {
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

  test("a provider with no branchScanner still yields a four-source answer", async () => {
    // RETARGETED (M139/STE-541). This read "Linear (provider, no
    // branchScanner) keeps the sequential path" — the load-bearing half of the
    // retired pin. Linear does not take this path any more; what is still true,
    // and still worth guarding, is the ALLOCATOR's own contract: an omitted
    // `branchScanner` degrades to an empty `branches` leg rather than throwing
    // or dropping the tracker leg. That matters for the surface the allocator
    // kept — the explicitly-typed `M<N>` collision refusal, which names all
    // five sources including the empty one.
    const fx = makeScanFixture();
    try {
      const provider = { listMilestones: async () => [{ name: "M97 — Labeled" }] };
      const r = await nextFreeMilestoneNumber(fx.specs, fx.changelog, provider);
      expect(r.next).toBe(102);
      expect(r.sources.tracker).toEqual([97]);
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
// AC-STE-417.5 — the tracker-less arm re-scoped OUT of AC-STE-377.4
//
// STE-377 pinned "Linear AND mode: none milestone allocation byte-unchanged".
// STE-417 reverses the tracker-less half on the grounds that STE-377's stated
// premise — no key available to claim from — is false. What follows is the
// replacement contract for the arm that used to live in the block above:
// `mode: none` mints, and the sequential scan is not merely unused on that
// path, it is unreachable from it.
// ───────────────────────────────────────────────────────────────────────

describe("AC-STE-417.5 — mode: none DIVERGES: the minted path never calls nextFreeMilestoneNumber", () => {
  // Same visible history as the AC-STE-377.4 scan fixture: a sequential
  // allocator looking at this tree answers 102.
  function makeMintFixture(): { specs: string; changelog: string; cleanup: () => void } {
    const root = mkdtempSync(join(tmpdir(), "ste417-diverge-"));
    const specs = join(root, "specs");
    mkdirSync(join(specs, "plan", "archive"), { recursive: true });
    writeFileSync(join(specs, "plan", "M101.md"), "# M101 — Sequential milestone\n");
    writeFileSync(join(specs, "plan", "archive", "M99.md"), "# M99 — Archived milestone\n");
    const changelog = join(root, "CHANGELOG.md");
    writeFileSync(changelog, "# Changelog\n\nM100 shipped.\n");
    return { specs, changelog, cleanup: () => rmSync(root, { recursive: true, force: true }) };
  }

  test("the minted id is opaque — it is not max+1 over the visible plan tree", () => {
    const fx = makeMintFixture();
    try {
      // The fixture's visible history would make `nextFreeMilestoneNumber`
      // answer 102. The minted path must ignore all of it.
      const result = mintMilestoneId(fx.specs);
      expect(result.milestoneId).not.toBe("M102");
      expect(result.milestoneId).not.toMatch(/^M\d+$/);
      expect(result.milestoneId).toMatch(/^M_[0-9A-HJKMNP-TV-Z]{6}$/);
      expect(result.milestoneId).toBe(milestoneIdFromUlid(result.id));
      expect(isMilestoneToken(result.milestoneId)).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("the same plan tree yields a DIFFERENT id on a second allocation (no shared counter)", () => {
    const fx = makeMintFixture();
    try {
      const a = mintMilestoneId(fx.specs);
      const b = mintMilestoneId(fx.specs);
      expect(a.id).not.toBe(b.id);
      expect(a.milestoneId).not.toBe(b.milestoneId);
    } finally {
      fx.cleanup();
    }
  });

  test("the five-way scan is UNREACHABLE from the minted path, not merely unused", () => {
    const fx = makeMintFixture();
    try {
      // `nextFreeMilestoneNumber` is async: every one of its five legs is
      // awaited. A synchronous return from `mintMilestoneId` is proof the
      // scan was never entered — no promise, nothing to await.
      const result = mintMilestoneId(fx.specs) as unknown as { then?: unknown };
      expect(result).not.toBeInstanceOf(Promise);
      expect(typeof result.then).toBe("undefined");
      // ...and the module imports neither the scan nor the branch leg
      // (import + call shapes only — prose may still NAME the bypass).
      const src = readFileSync(join(import.meta.dir, "mint_milestone_id.ts"), "utf-8");
      expect(src).not.toMatch(/from\s+["'][^"']*next_free_milestone_number["']/);
      expect(src).not.toMatch(/\bnextFreeMilestoneNumber\s*\(/);
      expect(src).not.toMatch(/from\s+["'][^"']*branch_milestone_scan["']/);
    } finally {
      fx.cleanup();
    }
  });

  test("existing M<N> plans in the same tracker-less tree still resolve (coexistence)", async () => {
    const fx = makeMintFixture();
    try {
      const minted = mintMilestoneId(fx.specs);
      writeFileSync(
        join(fx.specs, "plan", `${minted.milestoneId}.md`),
        `# ${minted.milestoneId} — Minted milestone\n`,
      );
      // The sequential helper still answers for any legacy `M<N>` caller and
      // is unperturbed by the minted plan sitting beside them.
      const r = await nextFreeMilestoneNumber(fx.specs, fx.changelog);
      expect(r.next).toBe(102);
      expect(r.sources.active).toEqual([101]);
      expect(PLAN_FILENAME_RE.test(`${minted.milestoneId}.md`)).toBe(true);
      expect(parseMilestoneToken(minted.milestoneId)).toEqual({
        kind: "epic",
        key: minted.id.slice(23, 29),
      });
    } finally {
      fx.cleanup();
    }
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
