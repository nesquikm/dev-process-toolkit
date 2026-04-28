// M18 STE-60 AC-STE-60.1/9 — Provider.filenameFor() semantics.
//
// Covers:
//   - LocalProvider.filenameFor → <short-ULID>.md (6-char tail of spec.id)
//     aligning with M16's AC-prefix rule (spec.id.slice(23, 29)).
//   - TrackerProvider.filenameFor → <tracker-id>.md using spec.tracker[<key>].
//   - ShortUlidCollisionError continues to fire when a new mode: none FR's
//     short-ULID tail matches an existing FR's tail (M16 behavior preserved
//     across the filename-convention change).

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanShortUlidCollision, ShortUlidCollisionError } from "../adapters/_shared/src/ac_prefix";
import { LocalProvider } from "../adapters/_shared/src/local_provider";
import type { FRSpec } from "../adapters/_shared/src/provider";
import { TrackerProvider, type AdapterDriver, type TicketStatusSummary } from "../adapters/_shared/src/tracker_provider";

const MODE_NONE_ULID = "fr_01HZ7XJFKP0000000000VDTAF4";
const MODE_NONE_SHORT = "VDTAF4";

class StubDriver implements AdapterDriver {
  trackerKey = "linear";
  async pullAcs(): Promise<unknown[]> { return []; }
  async pushAcToggle(): Promise<void> {}
  async transitionStatus(): Promise<void> {}
  async upsertTicketMetadata(): Promise<string> { return "STE-60"; }
  async getTicketStatus(): Promise<TicketStatusSummary> {
    return { status: "unstarted", assignee: null };
  }
  getUrl(ref: string): string { return `https://linear.app/x/issue/${ref}`; }
}

function makeRepo(): string {
  const repoRoot = mkdtempSync(join(tmpdir(), "m18-filename-"));
  mkdirSync(join(repoRoot, "specs", "frs"), { recursive: true });
  return repoRoot;
}

describe("AC-STE-60.1 — LocalProvider.filenameFor returns <short-ULID>.md", () => {
  test("mode: none spec → last-6-char tail + .md", () => {
    const provider = new LocalProvider({ repoRoot: makeRepo() });
    const spec: FRSpec = {
      frontmatter: { id: MODE_NONE_ULID, tracker: {} },
      body: "",
    };
    expect(provider.filenameFor(spec)).toBe(`${MODE_NONE_SHORT}.md`);
  });

  test("LocalProvider never returns tracker-id form even if tracker is present (no driver binding)", () => {
    const provider = new LocalProvider({ repoRoot: makeRepo() });
    const spec: FRSpec = {
      frontmatter: { id: MODE_NONE_ULID, tracker: { linear: "STE-60" } },
      body: "",
    };
    // LocalProvider is tracker-agnostic — it always uses the short-ULID tail.
    expect(provider.filenameFor(spec)).toBe(`${MODE_NONE_SHORT}.md`);
  });

  test("throws on non-string id (caller contract)", () => {
    const provider = new LocalProvider({ repoRoot: makeRepo() });
    expect(() =>
      provider.filenameFor({
        frontmatter: { id: 42 as unknown as string },
        body: "",
      }),
    ).toThrow(TypeError);
  });
});

describe("AC-STE-60.1 — TrackerProvider.filenameFor returns <tracker-id>.md", () => {
  test("returns spec.tracker[driver.trackerKey] + .md", () => {
    const provider = new TrackerProvider({
      driver: new StubDriver(),
      currentUser: "nobody",
    });
    const spec: FRSpec = {
      frontmatter: { id: MODE_NONE_ULID, tracker: { linear: "STE-60" } },
      body: "",
    };
    expect(provider.filenameFor(spec)).toBe("STE-60.md");
  });

  test("falls back to short-ULID when the FR has no binding for the driver's trackerKey", () => {
    const provider = new TrackerProvider({
      driver: new StubDriver(),
      currentUser: "nobody",
    });
    const spec: FRSpec = {
      frontmatter: { id: MODE_NONE_ULID, tracker: { jira: "PROJ-99" } },
      body: "",
    };
    // Unbound for this driver → fall back to short-ULID (mode-none shape).
    expect(provider.filenameFor(spec)).toBe(`${MODE_NONE_SHORT}.md`);
  });
});

describe("AC-STE-60.1 — filenameFor never includes directory separators", () => {
  test("LocalProvider", () => {
    const provider = new LocalProvider({ repoRoot: makeRepo() });
    const name = provider.filenameFor({ frontmatter: { id: MODE_NONE_ULID }, body: "" });
    expect(name.includes("/")).toBe(false);
    expect(name.endsWith(".md")).toBe(true);
  });

  test("TrackerProvider", () => {
    const provider = new TrackerProvider({ driver: new StubDriver(), currentUser: "nobody" });
    const name = provider.filenameFor({
      frontmatter: { id: MODE_NONE_ULID, tracker: { linear: "STE-60" } },
      body: "",
    });
    expect(name.includes("/")).toBe(false);
    expect(name.endsWith(".md")).toBe(true);
  });
});

describe("AC-STE-60.9 — ShortUlidCollisionError still fires with new convention", () => {
  test("collision on short-ULID tail rejects write regardless of filename shape", async () => {
    const repoRoot = makeRepo();
    const frsDir = join(repoRoot, "specs", "frs");
    const existingId = "fr_01HZ7XJFKP0000000000VDTAF4";
    const newId = "fr_02ABCDEFGH0000000000VDTAF4";
    // Forge a parseable existing FR under its short-ULID filename (new convention).
    writeFileSync(
      join(frsDir, "VDTAF4.md"),
      `---\nid: ${existingId}\ntitle: existing\ntracker: {}\n---\n`,
    );
    const newSpec: FRSpec = {
      frontmatter: { id: newId, tracker: {} },
      body: "",
    };
    await expect(scanShortUlidCollision(join(repoRoot, "specs"), newSpec)).rejects.toThrow(
      ShortUlidCollisionError,
    );
    rmSync(repoRoot, { recursive: true, force: true });
  });
});
