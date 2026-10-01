// STE-654 (M_a85e46, design C-F2) — FR titles round-trip through both FR
// frontmatter writers (buildFRFrontmatter and importFromTracker's renderer)
// under the toolkit's parser and under Bun.YAML, and plain titles stay
// byte-identical to HEAD.
//
// Mutation controls:
//   - never-quote mutation  → the AC-STE-654.6/.7 round-trip rows go red;
//   - always-quote mutation → the AC-STE-654.8 byte-identical rows go red.
//
// The importFromTracker leg uses an unbound key in an empty specs dir and
// passes NO ownership context, so neither the STE-652 bound-key refusal nor
// the STE-653 shared-ownership path runs.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildFRFrontmatter } from "../adapters/_shared/src/fr_frontmatter";
import { parseFrontmatter } from "../adapters/_shared/src/frontmatter";
import { importFromTracker } from "../adapters/_shared/src/import";
import type { FRMetadata, FRSpec, Provider } from "../adapters/_shared/src/provider";

// The design's 32-title TITLES table (C-F2).
const TITLES: readonly string[] = [
  "[DPT-TEST] FE half",
  "{x} y",
  "- dash",
  "? q",
  "*star",
  "&anchor x",
  "!tag x",
  "| pipe",
  "> gt",
  "%pct",
  "@at",
  "`/setup` x",
  "'a' b",
  "null",
  "Null",
  "~",
  "true",
  "false",
  "yes",
  "No",
  "123",
  "1e3",
  "0x1F",
  ".5",
  'Say "hi"',
  "back\\slash",
  "a\nb",
  "del\x7fx",
  "ls x",
  "trailing ",
  "Auth: add SSO",
  "Support #tags",
];

// Titles that start with a letter, are not reserved scalars, contain none of
// `" \ : #` or control / line-separator characters, and have no edge
// whitespace — emitted unquoted, byte-identical to HEAD.
const PLAIN_TITLES: readonly string[] = [
  "Add SSO login",
  "Profile — leave request",
  "Fix login bug",
  "Nullable fields stay nullable",
  "Yesterday's report",
  "On-call rota",
];

const TRACKER_KEY = "jira";
const TRACKER_ID = "GF-9001";

function buildFor(title: string): string {
  return buildFRFrontmatter(
    { title, milestone: "M_a85e46", createdAt: "2026-10-01T00:00:00Z" },
    { key: TRACKER_KEY, id: TRACKER_ID },
  );
}

/** The YAML text between the opening and closing `---` delimiters. */
function frontmatterBlock(doc: string): string {
  const m = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(doc);
  if (!m) throw new Error("no frontmatter block");
  return m[1]!;
}

function bunYamlTitle(doc: string): unknown {
  return (Bun.YAML.parse(frontmatterBlock(doc)) as Record<string, unknown>)["title"];
}

// --- importFromTracker stub ------------------------------------------------

const tmpRoots: string[] = [];
afterAll(() => {
  for (const d of tmpRoots) rmSync(d, { recursive: true, force: true });
});

function stubProvider(title: string): Provider {
  const stub = {
    mode: "tracker" as const,
    async listMilestones() {
      return [];
    },
    async listActiveFRs() {
      return [];
    },
    async getMetadata(id: string): Promise<FRMetadata> {
      const m = {
        id,
        title,
        milestone: "",
        status: "active",
        tracker: {},
        inFlightBranch: null,
        assignee: null,
      } as unknown as FRMetadata;
      (m as unknown as Record<string, unknown>)["description"] = "Body.";
      (m as unknown as Record<string, unknown>)["acs"] = ["Thing works."];
      return m;
    },
    async sync() {
      return { kind: "ok", updated: [], conflicts: [], message: "ok" };
    },
    getUrl() {
      return null;
    },
    async claimLock() {
      return { kind: "claimed", branch: null, message: "" };
    },
    async releaseLock() {
      return "already-released";
    },
    async getTicketStatus() {
      return { status: "local-no-tracker" };
    },
    filenameFor(spec: FRSpec): string {
      const tracker = spec.frontmatter["tracker"] as Record<string, string>;
      return `${Object.values(tracker)[0]}.md`;
    },
  };
  return stub as unknown as Provider;
}

async function importFor(title: string): Promise<string> {
  const specsDir = mkdtempSync(join(tmpdir(), "fr-yaml-roundtrip-"));
  tmpRoots.push(specsDir);
  mkdirSync(join(specsDir, "frs"), { recursive: true });
  // No ownership argument: STE-653's shared-ownership path never runs, and
  // the empty specs dir binds no key, so STE-652's refusal never fires.
  await importFromTracker(TRACKER_KEY, TRACKER_ID, stubProvider(title), specsDir, async () => "M_a85e46");
  return readFileSync(join(specsDir, "frs", `${TRACKER_ID}.md`), "utf-8");
}

// ===========================================================================
// AC-STE-654.6 — buildFRFrontmatter round-trips every TITLES row.
// ===========================================================================

describe("AC-STE-654.6 — buildFRFrontmatter titles round-trip", () => {
  test("AC-STE-654.6: the TITLES table holds the design's 32 rows", () => {
    expect(TITLES.length).toBe(32);
    expect(new Set(TITLES).size).toBe(32);
  });

  test.each(TITLES.map((t) => [JSON.stringify(t), t] as const))(
    "AC-STE-654.6: %s reads back identically under parseFrontmatter",
    (_label, t) => {
      expect(parseFrontmatter(buildFor(t))["title"]).toBe(t);
    },
  );

  test.each(TITLES.map((t) => [JSON.stringify(t), t] as const))(
    "AC-STE-654.6: %s reads back identically under Bun.YAML.parse",
    (_label, t) => {
      expect(bunYamlTitle(buildFor(t))).toBe(t);
    },
  );
});

// ===========================================================================
// AC-STE-654.7 — the FR file importFromTracker writes round-trips too.
// ===========================================================================

describe("AC-STE-654.7 — importFromTracker titles round-trip", () => {
  test.each(TITLES.map((t) => [JSON.stringify(t), t] as const))(
    "AC-STE-654.7: %s reads back identically from the imported FR file (parseFrontmatter + Bun.YAML)",
    async (_label, t) => {
      const doc = await importFor(t);
      expect(parseFrontmatter(doc)["title"]).toBe(t);
      expect(bunYamlTitle(doc)).toBe(t);
    },
  );
});

// ===========================================================================
// AC-STE-654.8 — plain titles stay unquoted and byte-identical (opposite
// break for an always-quote mutation).
// ===========================================================================

describe("AC-STE-654.8 — plain titles are emitted unquoted, byte-identical to HEAD", () => {
  test.each(PLAIN_TITLES.map((t) => [t] as const))(
    "AC-STE-654.8: buildFRFrontmatter emits the plain line `title: %s`",
    (t) => {
      const lines = buildFor(t).split("\n");
      expect(lines[1]).toBe(`title: ${t}`);
    },
  );

  test.each(PLAIN_TITLES.map((t) => [t] as const))(
    "AC-STE-654.8: importFromTracker emits the plain line `title: %s`",
    async (t) => {
      const lines = (await importFor(t)).split("\n");
      expect(lines[1]).toBe(`title: ${t}`);
    },
  );
});

// ===========================================================================
// AC-STE-654.9 — the reader undoes the writer's escapes.
// ===========================================================================

describe("AC-STE-654.9 — parseFrontmatter unescapes quoted titles", () => {
  const fm = (line: string) => `---\n${line}\nmilestone: M1\n---\n\nbody\n`;

  test('AC-STE-654.9: `title: "Say \\"hi\\""` reads as Say "hi"', () => {
    expect(parseFrontmatter(fm('title: "Say \\"hi\\""'))["title"]).toBe('Say "hi"');
  });

  test("AC-STE-654.9: `title: 'it''s'` reads as it's", () => {
    expect(parseFrontmatter(fm("title: 'it''s'"))["title"]).toBe("it's");
  });

  // Control (green at HEAD): a double-quoted value whose escapes are not
  // valid JSON keeps today's raw reading.
  test("AC-STE-654.9: a double-quoted value with non-JSON escapes reads exactly as at HEAD", () => {
    expect(parseFrontmatter(fm('title: "\\[x\\] y"'))["title"]).toBe("\\[x\\] y");
    expect(parseFrontmatter(fm('title: "a\\x41b"'))["title"]).toBe("a\\x41b");
  });
});

// ===========================================================================
// AC-STE-654.10 — reserved words stay strings.
// ===========================================================================

describe("AC-STE-654.10 — null and true titles read back as strings", () => {
  for (const t of ["null", "true"]) {
    test(`AC-STE-654.10: buildFRFrontmatter title ${t} reads back as the string "${t}"`, () => {
      const v = parseFrontmatter(buildFor(t))["title"];
      expect(typeof v).toBe("string");
      expect(v).toBe(t);
    });
  }
});

describe("AC-STE-654.6 hardening (review r0) — the emitted title line is YAML-1.2-printable", () => {
  // YAML 1.2 excludes DEL and C1 from the printable set and line separators
  // and the BOM are not safe raw inside a scalar, so a quoted title must carry
  // them as \uXXXX escapes. Bun.YAML is lenient about the raw bytes, so the
  // round-trip legs alone cannot see a writer that stopped escaping them.
  for (const title of TITLES) {
    test(`AC-STE-654.6: ${JSON.stringify(title)} — the title line carries no raw DEL, C1, U+2028/2029 or BOM`, () => {
      const line = buildFor(title).split("\n").find((l) => l.startsWith("title:"))!;
      expect(line, "no title line").toBeDefined();
      const UNPRINTABLE = new RegExp("[\\x7f-\\x9f\\u2028\\u2029\\ufeff]");
      expect(UNPRINTABLE.test(line), JSON.stringify(line)).toBe(false);
    });
  }
});

describe("AC-STE-654.6 hardening (review r0) — a lone surrogate round-trips; a valid pair stays plain", () => {
  const LONE = ["Fix " + String.fromCharCode(0xd800) + " x", "Fix " + String.fromCharCode(0xdc00) + " x"];
  for (const title of LONE) {
    test(`AC-STE-654.6: lone surrogate ${JSON.stringify(title)} is quoted and reads back identically under parseFrontmatter`, () => {
      const doc = buildFor(title);
      const line = doc.split("\n").find((l) => l.startsWith("title:"))!;
      expect(line.startsWith('title: "'), line).toBe(true);
      // The escaped form survives a UTF-8 write and read, where a raw lone surrogate becomes U+FFFD.
      const disk = new TextDecoder().decode(new TextEncoder().encode(doc));
      expect(parseFrontmatter(disk)["title"]).toBe(title);
    });
  }
  test("AC-STE-654.8: a title with a valid surrogate pair (an emoji) stays plain, byte-identical", () => {
    const title = "Ship it " + String.fromCodePoint(0x1f680);
    expect(buildFor(title)).toContain(`\ntitle: ${title}\n`);
  });
});
