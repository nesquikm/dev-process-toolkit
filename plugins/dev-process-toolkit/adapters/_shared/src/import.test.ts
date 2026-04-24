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
}

// StubProvider implements only `Provider` (not `IdentityMinter`, STE-85) —
// `importFromTracker` runs on the tracker path post-STE-76 and never mints
// a ULID; `mintId` is structurally unreachable from this stub.
class StubProvider implements Provider {
  getMetadataCalls: string[] = [];
  syncCalls: FRSpec[] = [];
  constructor(private readonly opts: StubOptions = {}) {}

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

  async releaseLock(): Promise<"transitioned" | "already-released"> {
    return "already-released";
  }

  async getTicketStatus(): Promise<{ status: string }> {
    return { status: "local-no-tracker" };
  }

  // M18 STE-60: default stub models a TrackerProvider — return
  // `<tracker-id>.md` when the FR carries a binding, else `<short-ULID>.md`.
  filenameFor(spec: FRSpec): string {
    const tracker = spec.frontmatter["tracker"];
    if (tracker && typeof tracker === "object" && !Array.isArray(tracker)) {
      for (const value of Object.values(tracker as Record<string, unknown>)) {
        if (typeof value === "string" && value.length > 0) return `${value}.md`;
      }
    }
    const id = spec.frontmatter["id"];
    if (typeof id !== "string") throw new TypeError("StubProvider.filenameFor: id missing");
    return `${id.slice(23, 29)}.md`;
  }
}

function makeSpecsDir(): string {
  const d = mkdtempSync(join(tmpdir(), "import-test-"));
  mkdirSync(join(d, "frs"), { recursive: true });
  return d;
}

describe("importFromTracker — happy path (AC-52.4, STE-76 AC-STE-76.5)", () => {
  test("creates FR file with correct frontmatter, body, and tracker ref; no id: line emitted", async () => {
    const specsDir = makeSpecsDir();
    try {
      const provider = new StubProvider({
        metadata: {
          title: "Fix login bug",
          description: "Users can't log in via SSO.",
          acs: ["Login works with SSO", "Error messages clear"],
        },
      });
      const returned = await importFromTracker(
        "linear",
        "LIN-1234",
        provider,
        specsDir,
        async () => "M14",
      );
      // STE-76: return value is the tracker ID — tracker-mode identity.
      expect(returned).toBe("LIN-1234");
      // M18 STE-60: tracker-mode FR files are named by tracker ID, not ULID.
      const path = join(specsDir, "frs", "LIN-1234.md");
      expect(existsSync(path)).toBe(true);
      const content = readFileSync(path, "utf-8");
      // STE-76 AC-STE-76.5: tracker-mode frontmatter MUST NOT carry id:
      expect(content).not.toMatch(/^id:\s/m);
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
      const returned = await importFromTracker(
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
      // M18 STE-60: tracker-mode filename is <tracker-id>.md.
      const content = readFileSync(join(specsDir, "frs", "LIN-1.md"), "utf-8");
      expect(content).toContain("milestone: M99");
      // STE-76: return value is the tracker ID.
      expect(returned).toBe("LIN-1");
    } finally {
      rmSync(specsDir, { recursive: true, force: true });
    }
  });

  // STE-76 AC-STE-76.5 note: `provider.mintId()` is never called on the
  // tracker path. Post-STE-85 this is enforced structurally — `Provider`
  // has no `mintId` method, so calling it on a `Provider`-typed value is
  // a `TS2339` error at compile time. No runtime assertion needed; the
  // type system is the gate.

  test("Provider.sync called after file write with the new FR spec; spec carries no id:", async () => {
    const specsDir = makeSpecsDir();
    try {
      const provider = new StubProvider();
      await importFromTracker("linear", "LIN-1", provider, specsDir, async () => "M14");
      expect(provider.syncCalls).toHaveLength(1);
      const spec = provider.syncCalls[0]!;
      // STE-76: frontmatter must not carry id in tracker mode.
      expect(spec.frontmatter["id"]).toBeUndefined();
      expect(spec.body.length).toBeGreaterThan(0);
      // Body also must not contain an id: frontmatter line.
      expect(spec.body).not.toMatch(/^id:\s/m);
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
      const returned = await importFromTracker(
        "linear",
        "LIN-2",
        provider,
        specsDir,
        async () => "M14",
      );
      // M18 STE-60: tracker-mode filename uses the tracker ID (LIN-2 here).
      const content = readFileSync(join(specsDir, "frs", "LIN-2.md"), "utf-8");
      expect(content).toContain("## Acceptance Criteria");
      expect(content).toMatch(/TODO:/);
      // STE-76: return value is the tracker ID.
      expect(returned).toBe("LIN-2");
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
      });
      await expect(
        importFromTracker("linear", "LIN-1", provider, specsDir, async () => "M14"),
      ).rejects.toThrow("sync failed");
      // Atomic rollback: partial file must not remain after sync failure.
      // M18 STE-60: tracker-mode filename uses the tracker ID.
      expect(existsSync(join(specsDir, "frs", "LIN-1.md"))).toBe(false);
      const files = readdirSync(join(specsDir, "frs"));
      expect(files).toHaveLength(0);
    } finally {
      rmSync(specsDir, { recursive: true, force: true });
    }
  });
});

describe("importFromTracker — filename derives from Provider.filenameFor (M18 STE-60)", () => {
  test("tracker-mode FR is written under <tracker-id>.md with NO id: line in frontmatter (STE-76)", async () => {
    const specsDir = makeSpecsDir();
    try {
      const provider = new StubProvider();
      const returned = await importFromTracker(
        "linear",
        "LIN-5",
        provider,
        specsDir,
        async () => "M14",
      );
      // M18 STE-60 AC-STE-60.3: tracker-mode filename keys on the tracker ID.
      const content = readFileSync(join(specsDir, "frs", "LIN-5.md"), "utf-8");
      // STE-76 AC-STE-76.5: no id: in tracker-mode frontmatter.
      expect(content).not.toMatch(/^id:\s/m);
      expect(content).toContain("  linear: LIN-5");
      expect(returned).toBe("LIN-5");
    } finally {
      rmSync(specsDir, { recursive: true, force: true });
    }
  });
});
