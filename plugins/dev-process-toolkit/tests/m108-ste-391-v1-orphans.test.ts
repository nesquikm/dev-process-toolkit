// M108 STE-391 AC-STE-391.4 — seed entry: v1-era orphans.
//
// Detector/action pair removes `specs/.dpt-layout`, `specs/INDEX.md` (both
// dead since v1.20.0), and the dead `### Sync log` subsection under
// `## Task Tracking` in CLAUDE.md (parser-ignored since v1.20.0). Only
// exact-shape matches are removed; anything else in those files is preserved
// byte-for-byte.
//
// The retired literals composed below are deliberate — this is a `.test.ts`
// decoy under the STE-384 carve-out.

import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { MIGRATIONS, type MigrationEntry } from "../adapters/_shared/src/migrations/index";

const DPT_LAYOUT_BODY = "version: v2\nmigrated_at: 2026-03-01T00:00:00Z\nmigration_commit: abc1234\n";
const INDEX_MD_BODY = [
  "# Spec Index",
  "",
  "| ULID | Title | Milestone | Status | Tracker |",
  "| --- | --- | --- | --- | --- |",
  "| [01HZX](frs/01HZX.md) | Sample | M3 | active | STE-9 |",
  "",
].join("\n");

const SYNC_LOG_BLOCK = [
  "### Sync log",
  "",
  "- 2026-04-01T10:00:00Z — pushed AC toggle STE-1.2",
  "- 2026-04-02T11:30:00Z — pulled status In Progress",
].join("\n");

const CLAUDE_MD_WITH_SYNC_LOG = [
  "# Fixture Project",
  "",
  "## Task Tracking",
  "",
  "mode: linear",
  "",
  SYNC_LOG_BLOCK,
  "",
  "## Key Commands",
  "",
  "- Test: `bun test`",
  "",
].join("\n");

const tmpRoots: string[] = [];

function makeTree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "ste-391-v1-"));
  tmpRoots.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, ...rel.split("/"));
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}

function cleanup(): void {
  while (tmpRoots.length > 0) {
    const dir = tmpRoots.pop()!;
    if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
}

function detecting(root: string): MigrationEntry[] {
  return MIGRATIONS.filter((e) => e.detect(root).applies);
}

function soleDetectingEntry(root: string): MigrationEntry {
  const hits = detecting(root);
  expect(hits.map((e) => e.id).length).toBe(1);
  return hits[0]!;
}

/** Collapse runs of blank lines so the assertion tolerates either legal
 *  blank-line outcome of a subsection splice while still pinning every
 *  content byte and its order. */
function collapsed(s: string): string {
  return s.replace(/\n{3,}/g, "\n\n");
}

function makeFullOrphanTree(): string {
  return makeTree({
    "specs/.dpt-layout": DPT_LAYOUT_BODY,
    "specs/INDEX.md": INDEX_MD_BODY,
    "specs/requirements.md": "# Requirements\n\nReal content.\n",
    "specs/frs/STE-1.md": "# STE-1\n\nkeep me\n",
    "CLAUDE.md": CLAUDE_MD_WITH_SYNC_LOG,
  });
}

// ---------------------------------------------------------------------------
// detection
// ---------------------------------------------------------------------------

describe("AC-STE-391.4 — detector fires on any of the three v1 orphans", () => {
  test("full orphan fixture: exactly ONE registry entry detects, kind script", () => {
    const root = makeFullOrphanTree();
    const entry = soleDetectingEntry(root);
    expect(entry.kind).toBe("script");
    expect(entry.requires_explicit_approval).toBeFalsy();
    const res = entry.detect(root);
    expect(res.applies).toBe(true);
    expect(res.evidence.length).toBeGreaterThan(0);
    cleanup();
  });

  test("specs/.dpt-layout ALONE fires", () => {
    const root = makeTree({ "specs/.dpt-layout": DPT_LAYOUT_BODY });
    expect(soleDetectingEntry(root).detect(root).applies).toBe(true);
    cleanup();
  });

  test("specs/INDEX.md ALONE fires", () => {
    const root = makeTree({ "specs/INDEX.md": INDEX_MD_BODY });
    expect(soleDetectingEntry(root).detect(root).applies).toBe(true);
    cleanup();
  });

  test("CLAUDE.md `### Sync log` under `## Task Tracking` ALONE fires", () => {
    const root = makeTree({ "CLAUDE.md": CLAUDE_MD_WITH_SYNC_LOG });
    expect(soleDetectingEntry(root).detect(root).applies).toBe(true);
    cleanup();
  });

  test("a `### Sync log` under some OTHER section is NOT the dead shape — no detection", () => {
    const root = makeTree({
      "CLAUDE.md": [
        "# Fixture Project",
        "",
        "## Notes",
        "",
        "### Sync log",
        "",
        "- a user-authored subsection that merely shares the name",
        "",
      ].join("\n"),
    });
    expect(detecting(root).map((e) => e.id)).toEqual([]);
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// detector purity
// ---------------------------------------------------------------------------

describe("AC-STE-391.4 — detect() leaves the fixture untouched", () => {
  test("content and mtime survive the detection walk", () => {
    const root = makeFullOrphanTree();
    const watched = [
      join(root, "specs", ".dpt-layout"),
      join(root, "specs", "INDEX.md"),
      join(root, "CLAUDE.md"),
    ];
    const before = watched.map((f) => ({
      content: readFileSync(f, "utf-8"),
      mtimeMs: statSync(f).mtimeMs,
    }));
    for (const e of MIGRATIONS) e.detect(root);
    watched.forEach((f, i) => {
      expect(readFileSync(f, "utf-8")).toBe(before[i]!.content);
      expect(statSync(f).mtimeMs).toBe(before[i]!.mtimeMs);
    });
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// apply
// ---------------------------------------------------------------------------

describe("AC-STE-391.4 — apply removes exactly the orphans", () => {
  test("both dead files are removed; neighbours are preserved byte-for-byte", () => {
    const root = makeFullOrphanTree();
    const entry = soleDetectingEntry(root);

    const result = entry.apply!(root);
    expect(result.changed.length).toBeGreaterThan(0);
    expect(result.summary.length).toBeGreaterThan(0);

    expect(existsSync(join(root, "specs", ".dpt-layout"))).toBe(false);
    expect(existsSync(join(root, "specs", "INDEX.md"))).toBe(false);
    expect(readFileSync(join(root, "specs", "requirements.md"), "utf-8")).toBe(
      "# Requirements\n\nReal content.\n",
    );
    expect(readFileSync(join(root, "specs", "frs", "STE-1.md"), "utf-8")).toBe(
      "# STE-1\n\nkeep me\n",
    );
    cleanup();
  });

  test("the Sync log subsection is spliced out of CLAUDE.md; every other byte survives", () => {
    const root = makeFullOrphanTree();
    const entry = soleDetectingEntry(root);
    entry.apply!(root);

    const after = readFileSync(join(root, "CLAUDE.md"), "utf-8");
    expect(after).not.toContain("### Sync log");
    expect(after).not.toContain("pushed AC toggle");
    expect(after).not.toContain("pulled status");

    // The prefix before the removed span is byte-identical…
    expect(
      after.startsWith("# Fixture Project\n\n## Task Tracking\n\nmode: linear"),
    ).toBe(true);
    // …and the whole file equals the original minus the subsection, modulo
    // blank-line collapse at the splice seam.
    const expected = [
      "# Fixture Project",
      "",
      "## Task Tracking",
      "",
      "mode: linear",
      "",
      "## Key Commands",
      "",
      "- Test: `bun test`",
      "",
    ].join("\n");
    expect(collapsed(after)).toBe(collapsed(expected));
    cleanup();
  });

  test("a user-authored `### Sync log` under another section is preserved byte-for-byte", () => {
    const userClaudeMd = [
      "# Fixture Project",
      "",
      "## Notes",
      "",
      "### Sync log",
      "",
      "- user-authored, not the dead shape",
      "",
    ].join("\n");
    const root = makeTree({
      "specs/.dpt-layout": DPT_LAYOUT_BODY,
      "CLAUDE.md": userClaudeMd,
    });
    const entry = soleDetectingEntry(root);
    entry.apply!(root);

    // Marker removed, user prose untouched.
    expect(existsSync(join(root, "specs", ".dpt-layout"))).toBe(false);
    expect(readFileSync(join(root, "CLAUDE.md"), "utf-8")).toBe(userClaudeMd);
    cleanup();
  });

  test("apply → detect=false; re-apply is a no-op", () => {
    const root = makeFullOrphanTree();
    const entry = soleDetectingEntry(root);

    entry.apply!(root);
    expect(entry.detect(root).applies).toBe(false);

    const claudeMdBefore = readFileSync(join(root, "CLAUDE.md"), "utf-8");
    const second = entry.apply!(root);
    expect(second.changed).toEqual([]);
    expect(readFileSync(join(root, "CLAUDE.md"), "utf-8")).toBe(claudeMdBefore);
    cleanup();
  });
});
