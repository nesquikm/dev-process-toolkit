// M_a85e46 / STE-652 (C-LEG) — importFromTracker refuses a key a local FR
// already binds, active or archived, BEFORE it reads the tracker, prompts,
// writes a file or syncs.
//
// At HEAD the importer never looked in `specs/frs/archive/`: importing a
// shipped ticket minted a second, active `specs/frs/<id>.md` and then
// `provider.sync`'d a re-rendered body onto the shipped ticket. An active
// binding was clobbered the same way (writeFileSync over local edits).
//
// Cases (bugfix plan FR3.2):
//   (a) archive/GB-12.md binds jira:GB-12 → rejects, naming the archived file
//   (b) on that refusal `specs/frs/` gains no file, every file byte-identical
//   (c) no getMetadata, no sync, no promptMilestone, no ownership read
//   (d) DISCRIMINATING: archive/legacy-x.md binds jira:GB-12 by FRONTMATTER →
//       still refused (a filename lookup — findFRPathByTrackerRef — misses it)
//   (e) an active FR binds the key → refused, that file byte-identical
//   (f) control: no local or archived copy → the import proceeds as at HEAD
//       (a refuse-everything mutation goes red here)
//   (g) control: archived / active FRs binding OTHER keys do not block
//       (a "refuse whenever archive/ is non-empty" mutation goes red here)
//
// Every refusal leg proves nothing happened: zero provider calls of ANY kind,
// zero prompt calls, zero ownership-context reads, and a byte snapshot of the
// whole specs tree that is identical before and after.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { importFromTracker, type ImportOwnershipContext } from "../adapters/_shared/src/import";
import type { FRMetadata, FRSpec, LockResult, Provider, SyncResult } from "../adapters/_shared/src/provider";

/** Records EVERY provider method call, so "no tracker read" covers all of them. */
class RecordingProvider implements Provider {
  readonly mode = "tracker" as const;
  calls: string[] = [];
  syncCalls: FRSpec[] = [];

  async listMilestones(): Promise<{ name: string }[]> {
    this.calls.push("listMilestones");
    return [];
  }
  async listActiveFRs(): Promise<string[]> {
    this.calls.push("listActiveFRs");
    return [];
  }
  async getMetadata(id: string): Promise<FRMetadata> {
    this.calls.push(`getMetadata(${id})`);
    const m = {
      id,
      title: "Imported ticket",
      milestone: "",
      status: "active",
      tracker: {},
      inFlightBranch: null,
      assignee: null,
    } as FRMetadata;
    (m as unknown as Record<string, unknown>)["description"] = "Ticket body.";
    (m as unknown as Record<string, unknown>)["acs"] = ["Thing works."];
    return m;
  }
  async sync(spec: FRSpec): Promise<SyncResult> {
    this.calls.push("sync");
    this.syncCalls.push(spec);
    return { kind: "ok", updated: [], conflicts: [], message: "ok" };
  }
  getUrl(): string | null {
    this.calls.push("getUrl");
    return null;
  }
  async claimLock(): Promise<LockResult> {
    this.calls.push("claimLock");
    return { kind: "claimed", branch: null, message: "" };
  }
  async releaseLock(): Promise<"transitioned" | "already-released"> {
    this.calls.push("releaseLock");
    return "already-released";
  }
  async getTicketStatus(): Promise<{ status: string }> {
    this.calls.push("getTicketStatus");
    return { status: "in_progress" };
  }
  filenameFor(spec: FRSpec): string {
    this.calls.push("filenameFor");
    const tracker = spec.frontmatter["tracker"] as Record<string, string>;
    return `${Object.values(tracker)[0]}.md`;
  }
}

function makeSpecsDir(): string {
  const root = mkdtempSync(join(tmpdir(), "import-archived-refusal-"));
  const specsDir = join(root, "specs");
  mkdirSync(join(specsDir, "frs", "archive"), { recursive: true });
  return specsDir;
}

function frBody(binding: string, opts: { status?: string; milestone?: string; title?: string } = {}): string {
  const status = opts.status ?? "active";
  const archivedAt = status === "archived" ? "2026-09-01T00:00:00Z" : "null";
  return (
    `---\ntitle: ${opts.title ?? "Local FR"}\nmilestone: ${opts.milestone ?? "M_GF_7"}\nstatus: ${status}\n` +
    `archived_at: ${archivedAt}\ntracker:\n  ${binding}\ncreated_at: 2026-08-01T00:00:00Z\n---\n\n` +
    `## Requirement\n\nLocal edits that must survive byte-for-byte.\n`
  );
}

function writeArchived(specsDir: string, name: string, binding: string): string {
  const p = join(specsDir, "frs", "archive", name);
  writeFileSync(p, frBody(binding, { status: "archived" }));
  return p;
}

function writeActive(specsDir: string, name: string, binding: string): string {
  const p = join(specsDir, "frs", name);
  writeFileSync(p, frBody(binding));
  return p;
}

/** Every file under `dir`, relative path → bytes. Directories are recorded too. */
function snapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string): void => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      const rel = relative(dir, p);
      if (statSync(p).isDirectory()) {
        out.set(`${rel}/`, "<dir>");
        walk(p);
      } else {
        out.set(rel, readFileSync(p, "latin1"));
      }
    }
  };
  walk(dir);
  return out;
}

interface Witness {
  promptCalls: number;
  ownershipReads: string[];
}

/** An ownership context that records every property read — the importer must not consult it before refusing. */
function trappedOwnership(w: Witness, projectRoot: string): ImportOwnershipContext {
  const target: ImportOwnershipContext = { projectRoot, pages: [], ticket: { key: "GB-12" } };
  return new Proxy(target, {
    get(t, prop, recv) {
      w.ownershipReads.push(String(prop));
      return Reflect.get(t, prop, recv);
    },
  });
}

async function refusalOf(run: () => Promise<unknown>): Promise<Error> {
  let caught: unknown;
  let resolved = false;
  try {
    await run();
    resolved = true;
  } catch (err) {
    caught = err;
  }
  expect(resolved, "importFromTracker resolved — it imported a key a local FR already binds").toBe(false);
  expect(caught).toBeInstanceOf(Error);
  return caught as Error;
}

/** Runs a refusal leg and asserts the full nothing-happened contract. */
async function expectRefusedWithNoEffect(
  specsDir: string,
  trackerKey: string,
  trackerId: string,
  withOwnership: boolean,
): Promise<{ err: Error; provider: RecordingProvider; w: Witness }> {
  const before = snapshot(specsDir);
  const provider = new RecordingProvider();
  const w: Witness = { promptCalls: 0, ownershipReads: [] };
  const ownership = withOwnership ? trappedOwnership(w, join(specsDir, "..")) : undefined;
  const err = await refusalOf(() =>
    importFromTracker(
      trackerKey,
      trackerId,
      provider,
      specsDir,
      async () => {
        w.promptCalls += 1;
        return "M_GF_7";
      },
      ownership,
    ),
  );
  // No tracker read, no sync — no provider method of any kind.
  expect(provider.calls, "a provider method ran before the refusal").toEqual([]);
  expect(provider.syncCalls).toEqual([]);
  // No prompt.
  expect(w.promptCalls, "promptMilestone ran before the refusal").toBe(0);
  // The ownership read (which classifies against the tracker answer) never ran.
  expect(w.ownershipReads, "the ownership context was consulted before the refusal").toEqual([]);
  // No file written, none removed, none changed.
  expect(snapshot(specsDir)).toEqual(before);
  return { err, provider, w };
}

describe("AC-STE-652.1 / AC-STE-652.2 — an archived binding refuses the import", () => {
  test("AC-STE-652.1 (a): archive/GB-12.md binding jira:GB-12 → rejects naming the archived file", async () => {
    const specsDir = makeSpecsDir();
    try {
      writeArchived(specsDir, "GB-12.md", "jira: GB-12");
      const { err } = await expectRefusedWithNoEffect(specsDir, "jira", "GB-12", false);
      expect(err.message).toContain("GB-12");
      expect(err.message).toContain("archive/GB-12.md");
      expect(err.message).toMatch(/archived/i);
    } finally {
      rmSync(join(specsDir, ".."), { recursive: true, force: true });
    }
  });

  test("AC-STE-652.2 (b): on that refusal provider.sync is not called and specs/frs/ gains no file", async () => {
    const specsDir = makeSpecsDir();
    try {
      writeArchived(specsDir, "GB-12.md", "jira: GB-12");
      const frsBefore = readdirSync(join(specsDir, "frs")).sort();
      const { provider } = await expectRefusedWithNoEffect(specsDir, "jira", "GB-12", false);
      expect(provider.syncCalls).toHaveLength(0);
      expect(readdirSync(join(specsDir, "frs")).sort()).toEqual(frsBefore);
      // The exact file HEAD wrote is absent.
      expect(existsSync(join(specsDir, "frs", "GB-12.md"))).toBe(false);
    } finally {
      rmSync(join(specsDir, ".."), { recursive: true, force: true });
    }
  });

  test("AC-STE-652.1 (c): refuses before getMetadata, promptMilestone AND the ownership read (ownership context passed)", async () => {
    const specsDir = makeSpecsDir();
    try {
      writeArchived(specsDir, "GB-12.md", "jira: GB-12");
      const { err } = await expectRefusedWithNoEffect(specsDir, "jira", "GB-12", true);
      expect(err.message).toContain("archive/GB-12.md");
    } finally {
      rmSync(join(specsDir, ".."), { recursive: true, force: true });
    }
  });

  test("AC-STE-652.1 (d) DISCRIMINATING: archive/legacy-x.md binds jira:GB-12 by frontmatter → still refused, naming legacy-x.md", async () => {
    // A direct-filename lookup (`archive/GB-12.md` exists?) misses this file:
    // the binding lives in frontmatter, the filename is a legacy name.
    const specsDir = makeSpecsDir();
    try {
      writeArchived(specsDir, "legacy-x.md", "jira: GB-12");
      // Control for the discriminator: the filename really is not the key.
      expect(existsSync(join(specsDir, "frs", "archive", "GB-12.md"))).toBe(false);
      const { err } = await expectRefusedWithNoEffect(specsDir, "jira", "GB-12", false);
      expect(err.message).toContain("archive/legacy-x.md");
    } finally {
      rmSync(join(specsDir, ".."), { recursive: true, force: true });
    }
  });
});

describe("AC-STE-652.3 — an active binding refuses the import and is left byte-identical", () => {
  test("AC-STE-652.3 (e): active specs/frs/GB-12.md binding jira:GB-12 → refused, file byte-identical", async () => {
    const specsDir = makeSpecsDir();
    try {
      const p = writeActive(specsDir, "GB-12.md", "jira: GB-12");
      const bytes = readFileSync(p, "latin1");
      const { err } = await expectRefusedWithNoEffect(specsDir, "jira", "GB-12", false);
      expect(err.message).toContain("GB-12.md");
      expect(err.message).not.toContain("archive/");
      expect(readFileSync(p, "latin1")).toBe(bytes);
    } finally {
      rmSync(join(specsDir, ".."), { recursive: true, force: true });
    }
  });

  test("AC-STE-652.3 (e′): an active FR under a NON-key filename binding the key is found by frontmatter → refused", async () => {
    const specsDir = makeSpecsDir();
    try {
      const p = writeActive(specsDir, "renamed-locally.md", "jira: GB-12");
      const bytes = readFileSync(p, "latin1");
      const { err } = await expectRefusedWithNoEffect(specsDir, "jira", "GB-12", true);
      expect(err.message).toContain("renamed-locally.md");
      expect(readFileSync(p, "latin1")).toBe(bytes);
      // HEAD would have written a SECOND active FR for the same key.
      expect(existsSync(join(specsDir, "frs", "GB-12.md"))).toBe(false);
    } finally {
      rmSync(join(specsDir, ".."), { recursive: true, force: true });
    }
  });
});

describe("AC-STE-652.4 — an unbound key imports exactly as at HEAD (opposite-break controls)", () => {
  async function runImport(specsDir: string, trackerKey: string, trackerId: string) {
    const provider = new RecordingProvider();
    let promptCalls = 0;
    const returned = await importFromTracker(trackerKey, trackerId, provider, specsDir, async () => {
      promptCalls += 1;
      return "M_GF_7";
    });
    return { provider, promptCalls, returned };
  }

  function expectHeadImport(
    specsDir: string,
    r: { provider: RecordingProvider; promptCalls: number; returned: string },
    trackerKey: string,
    trackerId: string,
  ): void {
    expect(r.returned).toBe(trackerId);
    expect(r.promptCalls).toBe(1);
    // HEAD order: one tracker read, the filename, one sync — nothing else.
    expect(r.provider.calls).toEqual([`getMetadata(${trackerKey}:${trackerId})`, "filenameFor", "sync"]);
    expect(r.provider.syncCalls).toHaveLength(1);
    const p = join(specsDir, "frs", `${trackerId}.md`);
    expect(existsSync(p)).toBe(true);
    const content = readFileSync(p, "utf-8");
    expect(content).toContain("title: Imported ticket");
    expect(content).toContain("milestone: M_GF_7");
    expect(content).toContain(`  ${trackerKey}: ${trackerId}`);
    expect(content).toContain(`- AC-${trackerId}.1: Thing works.`);
    expect(r.provider.syncCalls[0]!.body).toBe(content);
  }

  test("AC-STE-652.4 (f): no local or archived copy → writes specs/frs/GB-12.md and syncs once", async () => {
    const specsDir = makeSpecsDir();
    try {
      expectHeadImport(specsDir, await runImport(specsDir, "jira", "GB-12"), "jira", "GB-12");
    } finally {
      rmSync(join(specsDir, ".."), { recursive: true, force: true });
    }
  });

  test("AC-STE-652.4 (f′): no specs/frs/archive/ directory at all → the import still proceeds", async () => {
    const specsDir = makeSpecsDir();
    try {
      rmSync(join(specsDir, "frs", "archive"), { recursive: true, force: true });
      expectHeadImport(specsDir, await runImport(specsDir, "linear", "STE-900"), "linear", "STE-900");
    } finally {
      rmSync(join(specsDir, ".."), { recursive: true, force: true });
    }
  });

  test("AC-STE-652.4 (g): archived and active FRs binding OTHER keys do not block — other files byte-identical", async () => {
    const specsDir = makeSpecsDir();
    try {
      const a = writeArchived(specsDir, "GB-13.md", "jira: GB-13");
      const b = writeArchived(specsDir, "legacy-y.md", "jira: GB-120"); // prefix/superstring trap
      const c = writeActive(specsDir, "GB-14.md", "jira: GB-14");
      const before = [a, b, c].map((p) => readFileSync(p, "latin1"));
      expectHeadImport(specsDir, await runImport(specsDir, "jira", "GB-12"), "jira", "GB-12");
      expect([a, b, c].map((p) => readFileSync(p, "latin1"))).toEqual(before);
    } finally {
      rmSync(join(specsDir, ".."), { recursive: true, force: true });
    }
  });
});
