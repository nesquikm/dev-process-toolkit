// Unit tests for importFromTracker (FR-52/FR-53 shared helper).
//
// Tests happy path, empty ACs (AC-52.7), error ordering (no partial file on
// sync failure), and milestone prompt callback invocation.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importFromTracker } from "./import";
import type {
  FRMetadata,
  FRSpec,
  LockResult,
  Provider,
  SyncResult,
} from "./provider";

interface StubOptions {
  metadata?: Partial<FRMetadata> & { description?: string; acs?: string[] };
  syncThrows?: Error;
  getMetadataThrows?: Error;
  mintedUlid?: string;
}

class StubProvider implements Provider {
  getMetadataCalls: string[] = [];
  syncCalls: FRSpec[] = [];
  mintCount = 0;
  constructor(private readonly opts: StubOptions = {}) {}

  mintId(): string {
    this.mintCount += 1;
    return this.opts.mintedUlid ?? "fr_01TESTIMPORTFIXTURE00000001";
  }

  async getMetadata(id: string): Promise<FRMetadata> {
    this.getMetadataCalls.push(id);
    if (this.opts.getMetadataThrows) throw this.opts.getMetadataThrows;
    const m = this.opts.metadata ?? {};
    const metadata = {
      id,
      title: m.title ?? "Test ticket",
      milestone: m.milestone ?? "",
      status: m.status ?? "active",
      tracker: m.tracker ?? {},
      inFlightBranch: m.inFlightBranch ?? null,
      assignee: m.assignee ?? null,
    } as FRMetadata;
    // extra fields consumed by importFromTracker via (metadata as any)
    (metadata as unknown as Record<string, unknown>)["description"] = m.description ?? "Ticket description body.";
    (metadata as unknown as Record<string, unknown>)["acs"] = m.acs ?? ["Thing works."];
    return metadata;
  }

  async sync(spec: FRSpec): Promise<SyncResult> {
    this.syncCalls.push(spec);
    if (this.opts.syncThrows) throw this.opts.syncThrows;
    return { kind: "ok", updated: [], conflicts: [], message: "ok" };
  }

  getUrl(): string | null {
    return null;
  }

  async claimLock(): Promise<LockResult> {
    return { kind: "claimed", branch: null, message: "" };
  }

  async releaseLock(): Promise<void> {}
}

function makeSpecsDir(): string {
  const d = mkdtempSync(join(tmpdir(), "import-test-"));
  mkdirSync(join(d, "frs"), { recursive: true });
  return d;
}

describe("importFromTracker — happy path (AC-52.4)", () => {
  test("creates FR file with correct frontmatter, body, and tracker ref", async () => {
    const specsDir = makeSpecsDir();
    try {
      const provider = new StubProvider({
        metadata: {
          title: "Fix login bug",
          description: "Users can't log in via SSO.",
          acs: ["Login works with SSO", "Error messages clear"],
        },
        mintedUlid: "fr_01IMPORTFIXTURE0000000001",
      });
      const ulid = await importFromTracker(
        "linear",
        "LIN-1234",
        provider,
        specsDir,
        async () => "M14",
      );
      expect(ulid).toBe("fr_01IMPORTFIXTURE0000000001");
      const path = join(specsDir, "frs", `${ulid}.md`);
      expect(existsSync(path)).toBe(true);
      const content = readFileSync(path, "utf-8");
      expect(content).toContain(`id: ${ulid}`);
      expect(content).toContain("title: Fix login bug");
      expect(content).toContain("milestone: M14");
      expect(content).toContain("status: active");
      expect(content).toContain("  linear: LIN-1234");
      expect(content).toContain("Users can't log in via SSO.");
      // FR-73 AC-73.1: imported ACs carry `AC-<TRACKER_ID>.<N>:` prefix.
      expect(content).toContain("- AC-LIN-1234.1: Login works with SSO");
      expect(content).toContain("- AC-LIN-1234.2: Error messages clear");
    } finally {
      rmSync(specsDir, { recursive: true, force: true });
    }
  });

  test("invokes promptMilestone callback and writes its return value", async () => {
    const specsDir = makeSpecsDir();
    try {
      const provider = new StubProvider();
      let promptCalls = 0;
      const ulid = await importFromTracker(
        "linear",
        "LIN-1",
        provider,
        specsDir,
        async () => {
          promptCalls += 1;
          return "M99";
        },
      );
      expect(promptCalls).toBe(1);
      const content = readFileSync(join(specsDir, "frs", `${ulid}.md`), "utf-8");
      expect(content).toContain("milestone: M99");
    } finally {
      rmSync(specsDir, { recursive: true, force: true });
    }
  });

  test("Provider.mintId called exactly once", async () => {
    const specsDir = makeSpecsDir();
    try {
      const provider = new StubProvider();
      await importFromTracker("linear", "LIN-1", provider, specsDir, async () => "M14");
      expect(provider.mintCount).toBe(1);
    } finally {
      rmSync(specsDir, { recursive: true, force: true });
    }
  });

  test("Provider.sync called after file write with the new FR spec", async () => {
    const specsDir = makeSpecsDir();
    try {
      const provider = new StubProvider({ mintedUlid: "fr_01TESTSYNCCALL000000000001" });
      await importFromTracker("linear", "LIN-1", provider, specsDir, async () => "M14");
      expect(provider.syncCalls).toHaveLength(1);
      const spec = provider.syncCalls[0]!;
      expect(spec.frontmatter["id"]).toBe("fr_01TESTSYNCCALL000000000001");
      expect(spec.body.length).toBeGreaterThan(0);
    } finally {
      rmSync(specsDir, { recursive: true, force: true });
    }
  });

  test("regenerates INDEX.md after write", async () => {
    const specsDir = makeSpecsDir();
    try {
      const provider = new StubProvider({ mintedUlid: "fr_01REGENINDEXTEST000000001" });
      await importFromTracker("linear", "LIN-1", provider, specsDir, async () => "M14");
      const indexPath = join(specsDir, "INDEX.md");
      expect(existsSync(indexPath)).toBe(true);
      const index = readFileSync(indexPath, "utf-8");
      expect(index).toContain("fr_01REGENINDEXTEST000000001");
    } finally {
      rmSync(specsDir, { recursive: true, force: true });
    }
  });
});

describe("importFromTracker — empty ACs (AC-52.7)", () => {
  test("tracker with zero ACs yields FR with TODO marker under Acceptance Criteria", async () => {
    const specsDir = makeSpecsDir();
    try {
      const provider = new StubProvider({
        metadata: {
          title: "Ticket with no ACs",
          description: "Stub description",
          acs: [],
        },
      });
      const ulid = await importFromTracker(
        "linear",
        "LIN-2",
        provider,
        specsDir,
        async () => "M14",
      );
      const content = readFileSync(join(specsDir, "frs", `${ulid}.md`), "utf-8");
      expect(content).toContain("## Acceptance Criteria");
      expect(content).toMatch(/TODO:/);
    } finally {
      rmSync(specsDir, { recursive: true, force: true });
    }
  });
});

describe("importFromTracker — error paths (AC-52.8 / ordering)", () => {
  test("getMetadata throws → no file written, no sync called, error propagates", async () => {
    const specsDir = makeSpecsDir();
    try {
      const provider = new StubProvider({
        getMetadataThrows: new Error("tracker unreachable"),
      });
      await expect(
        importFromTracker("linear", "LIN-1", provider, specsDir, async () => "M14"),
      ).rejects.toThrow("tracker unreachable");
      expect(provider.syncCalls).toHaveLength(0);
      // No stray FR files written (plan Phase B verify: "no partial file on failure")
      const files = readdirSync(join(specsDir, "frs"));
      expect(files).toHaveLength(0);
    } finally {
      rmSync(specsDir, { recursive: true, force: true });
    }
  });

  test("promptMilestone throws → no mint, no file, no sync", async () => {
    const specsDir = makeSpecsDir();
    try {
      const provider = new StubProvider();
      await expect(
        importFromTracker("linear", "LIN-1", provider, specsDir, async () => {
          throw new Error("user cancelled milestone pick");
        }),
      ).rejects.toThrow("user cancelled milestone pick");
      expect(provider.mintCount).toBe(0);
      expect(provider.syncCalls).toHaveLength(0);
      const files = readdirSync(join(specsDir, "frs"));
      expect(files).toHaveLength(0);
    } finally {
      rmSync(specsDir, { recursive: true, force: true });
    }
  });

  test("sync failure propagates AND rolls back partial FR file (plan Phase B)", async () => {
    const specsDir = makeSpecsDir();
    try {
      const provider = new StubProvider({
        syncThrows: new Error("sync failed"),
        mintedUlid: "fr_01SYNCFAILURETESTFIX00001",
      });
      await expect(
        importFromTracker("linear", "LIN-1", provider, specsDir, async () => "M14"),
      ).rejects.toThrow("sync failed");
      // Atomic rollback: partial file must not remain after sync failure
      expect(
        existsSync(join(specsDir, "frs", "fr_01SYNCFAILURETESTFIX00001.md")),
      ).toBe(false);
      const files = readdirSync(join(specsDir, "frs"));
      expect(files).toHaveLength(0);
    } finally {
      rmSync(specsDir, { recursive: true, force: true });
    }
  });
});

describe("importFromTracker — filename ↔ id equality (NFR-15)", () => {
  test("minted ULID matches both filename and frontmatter id", async () => {
    const specsDir = makeSpecsDir();
    try {
      const provider = new StubProvider({
        mintedUlid: "fr_01IDEQFILENAMETEST00000001",
      });
      const ulid = await importFromTracker(
        "linear",
        "LIN-5",
        provider,
        specsDir,
        async () => "M14",
      );
      const content = readFileSync(join(specsDir, "frs", `${ulid}.md`), "utf-8");
      expect(content).toContain(`id: ${ulid}`);
    } finally {
      rmSync(specsDir, { recursive: true, force: true });
    }
  });
});
