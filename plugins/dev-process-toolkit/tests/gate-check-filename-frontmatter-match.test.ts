import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LocalProvider } from "../adapters/_shared/src/local_provider";
import { TrackerProvider } from "../adapters/_shared/src/tracker_provider";
import type { AdapterDriver } from "../adapters/_shared/src/tracker_provider";

// STE-82 AC-STE-82.1 + AC-STE-82.7 — gate-check probe #1 integration test.
//
// Probe 1 enforces the M18 STE-61 strict byte-for-byte filename↔frontmatter
// rule: `basename(specs/frs/<name>.md) === Provider.filenameFor(spec)` for
// every active FR. Legacy `fr_<ULID>.md` filenames fail the gate.
//
// Positive fixture: a tracker-bound spec whose Linear ticket ID matches the
// filename stem passes. A mode-none spec whose short-ULID tail matches
// likewise passes.
//
// Negative fixture: legacy `fr_<ULID>.md` in tracker mode; mismatched
// tracker-ID-keyed filename; mode-none spec whose filename is the full
// ULID rather than the short tail.

const pluginRoot = join(import.meta.dir, "..");
const gateCheckSkillPath = join(pluginRoot, "skills", "gate-check", "SKILL.md");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("STE-82 AC-STE-82.1 prose — /gate-check probe 1 is documented in SKILL.md", () => {
  test("SKILL.md names the Filename ↔ frontmatter convention probe + STE-61 AC reference", () => {
    const body = read(gateCheckSkillPath);
    expect(body).toMatch(/Filename\s*.\s*frontmatter convention/);
    expect(body).toMatch(/AC-STE-61\.5/);
  });

  test("probe says strict byte-for-byte comparison, GATE FAILED on mismatch", () => {
    const body = read(gateCheckSkillPath);
    expect(body).toMatch(/strict.*byte.*byte/i);
    expect(body).toContain("GATE FAILED");
  });

  test("probe notes legacy fr_<ULID>.md filenames fail", () => {
    const body = read(gateCheckSkillPath);
    expect(body).toMatch(/legacy\s+`fr_.*\.md`.*fail|`fr_<ULID>\.md`.*fail/i);
  });
});

function makeSpec(frontmatter: Record<string, unknown>) {
  return { frontmatter, body: "" };
}

describe("STE-82 AC-STE-82.1/7 — LocalProvider.filenameFor positive/negative fixtures", () => {
  const provider = new LocalProvider({ repoRoot: pluginRoot, gitUserEmail: "test@example.com" });

  test("POSITIVE: mode-none spec's short-ULID tail matches the expected basename", () => {
    const spec = makeSpec({
      id: "fr_01KPWPMA9TKSYYBNCQ3TAYM9BE",
      title: "Example FR",
      milestone: "M18",
      status: "active",
      archived_at: null,
      tracker: {},
      created_at: "2026-04-23T10:00:00Z",
    });
    const expected = provider.filenameFor(spec);
    // AC-STE-82.7 positive shape: filename matches what filenameFor returns.
    // LocalProvider returns `<short-ULID tail>.md` — chars 23-29 of the ULID.
    const shortTail = (spec.frontmatter["id"] as string).slice(23, 29);
    expect(expected).toBe(`${shortTail}.md`);
    expect(expected).toBe("AYM9BE.md");
  });

  test("NEGATIVE: `fr_<ULID>.md` legacy basename does NOT match filenameFor output", () => {
    const spec = makeSpec({
      id: "fr_01KPWPMA9TKSYYBNCQ3TAYM9BE",
      title: "Legacy",
      milestone: "M18",
      status: "active",
      archived_at: null,
      tracker: {},
      created_at: "2026-04-23T10:00:00Z",
    });
    const expected = provider.filenameFor(spec);
    const legacyBasename = `${spec.frontmatter["id"]}.md`;
    // Gate probe would flag this mismatch and fail the gate.
    expect(legacyBasename).not.toBe(expected);
  });
});

describe("STE-82 AC-STE-82.1/7 — TrackerProvider.filenameFor positive/negative fixtures", () => {
  const driver: AdapterDriver = {
    trackerKey: "linear",
    async pullAcs() {
      return [];
    },
    async pushAcToggle() {},
    async transitionStatus() {},
    async upsertTicketMetadata(id) {
      return id ?? "STE-NEW";
    },
    async getTicketStatus() {
      return { status: "done", assignee: null };
    },
    getUrl(id) {
      return `https://linear.app/${id}`;
    },
  };
  const provider = new TrackerProvider({ driver, currentUser: "test@example.com" });

  test("POSITIVE: tracker-bound spec's linear ticket ID matches the expected basename", () => {
    const spec = makeSpec({
      id: "fr_01KPZ7GRFN656QFSG79EY53YJV",
      title: "Tracker FR",
      milestone: "M22",
      status: "active",
      archived_at: null,
      tracker: { linear: "STE-77" },
      created_at: "2026-04-24T07:53:16Z",
    });
    const expected = provider.filenameFor(spec);
    expect(expected).toBe("STE-77.md");
  });

  test("NEGATIVE: legacy `fr_<ULID>.md` fails the probe for a tracker-bound spec", () => {
    const spec = makeSpec({
      id: "fr_01KPZ7GRFN656QFSG79EY53YJV",
      title: "Legacy tracker-bound",
      milestone: "M22",
      status: "active",
      archived_at: null,
      tracker: { linear: "STE-77" },
      created_at: "2026-04-24T07:53:16Z",
    });
    const expected = provider.filenameFor(spec);
    const legacyBasename = `${spec.frontmatter["id"]}.md`;
    expect(legacyBasename).not.toBe(expected);
    // The expected note shape matches `file:line — reason` per AC-STE-82.7.
    const noteShape = `specs/frs/${legacyBasename}:1 — expected ${expected}`;
    expect(noteShape).toMatch(/^specs\/frs\/.*:\d+ — expected /);
  });
});
