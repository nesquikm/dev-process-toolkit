// Phase C Tier 4 tests for index_gen.ts (FR-40, AC-40.4/5, NFR-13).

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { regenerateIndex } from "./index_gen";

let work: string;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "dpt-index-gen-"));
  mkdirSync(join(work, "specs", "frs", "archive"), { recursive: true });
});
afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

function writeFr(relPath: string, frontmatter: Record<string, string>) {
  const body = [
    "---",
    ...Object.entries(frontmatter).map(([k, v]) => `${k}: ${v}`),
    "---",
    "",
    "## Requirement",
    "",
    "Body.",
    "",
  ].join("\n");
  const full = join(work, relPath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, body);
}

describe("regenerateIndex — active FR enumeration (AC-40.4)", () => {
  test("lists only active FRs; excludes specs/frs/archive/", async () => {
    writeFr("specs/frs/fr_01HZ0000000000000000000001.md", {
      id: "fr_01HZ0000000000000000000001",
      title: "Active one",
      milestone: "M13",
      status: "active",
    });
    writeFr("specs/frs/archive/fr_01HZ000000000000000000X99.md", {
      id: "fr_01HZ000000000000000000X99",
      title: "Archived one",
      milestone: "M1",
      status: "archived",
    });
    await regenerateIndex(join(work, "specs"), { now: "2026-04-21T10:30:00Z" });
    const out = readFileSync(join(work, "specs", "INDEX.md"), "utf-8");
    expect(out).toContain("fr_01HZ0000000000000000000001");
    expect(out).not.toContain("X99");
  });
});

describe("regenerateIndex — sort order (AC-40.5)", () => {
  test("sorts by milestone ASC, then status (active < in_progress < draft), then ULID ASC", async () => {
    writeFr("specs/frs/fr_01HZ0000000000000000000030.md", {
      id: "fr_01HZ0000000000000000000030",
      title: "C (M14 active)",
      milestone: "M14",
      status: "active",
    });
    writeFr("specs/frs/fr_01HZ0000000000000000000020.md", {
      id: "fr_01HZ0000000000000000000020",
      title: "B (M13 in_progress)",
      milestone: "M13",
      status: "in_progress",
    });
    writeFr("specs/frs/fr_01HZ0000000000000000000010.md", {
      id: "fr_01HZ0000000000000000000010",
      title: "A (M13 active, lower ULID)",
      milestone: "M13",
      status: "active",
    });
    writeFr("specs/frs/fr_01HZ0000000000000000000015.md", {
      id: "fr_01HZ0000000000000000000015",
      title: "A2 (M13 active, higher ULID)",
      milestone: "M13",
      status: "active",
    });
    await regenerateIndex(join(work, "specs"), { now: "2026-04-21T10:30:00Z" });
    const out = readFileSync(join(work, "specs", "INDEX.md"), "utf-8");
    const lines = out.split("\n");
    const rows = lines
      .filter((l) => l.startsWith("| [fr_"))
      .map((l) => {
        const m = /\[(fr_[^\]]+)\]/.exec(l);
        return m ? m[1] : "";
      });
    expect(rows).toEqual([
      "fr_01HZ0000000000000000000010",
      "fr_01HZ0000000000000000000015",
      "fr_01HZ0000000000000000000020",
      "fr_01HZ0000000000000000000030",
    ]);
  });
});

describe("regenerateIndex — determinism (NFR-13)", () => {
  test("two regenerations with identical input produce byte-identical INDEX.md", async () => {
    writeFr("specs/frs/fr_01HZ0000000000000000000001.md", {
      id: "fr_01HZ0000000000000000000001",
      title: "Det",
      milestone: "M13",
      status: "active",
    });
    await regenerateIndex(join(work, "specs"), { now: "2026-04-21T10:30:00Z" });
    const a = readFileSync(join(work, "specs", "INDEX.md"), "utf-8");
    await regenerateIndex(join(work, "specs"), { now: "2026-04-21T10:30:00Z" });
    const b = readFileSync(join(work, "specs", "INDEX.md"), "utf-8");
    expect(a).toBe(b);
  });
});

describe("regenerateIndex — atomic write (NFR-13)", () => {
  test("leaves prior INDEX.md intact if writeFile errors (simulated via readonly tmp path)", async () => {
    writeFr("specs/frs/fr_01HZ0000000000000000000001.md", {
      id: "fr_01HZ0000000000000000000001",
      title: "Pre",
      milestone: "M13",
      status: "active",
    });
    await regenerateIndex(join(work, "specs"), { now: "2026-04-21T10:30:00Z" });
    const pre = readFileSync(join(work, "specs", "INDEX.md"), "utf-8");

    // Corrupt one FR to trigger an error during regeneration
    writeFileSync(join(work, "specs", "frs", "fr_01HZ0000000000000000000001.md"), "not valid frontmatter");
    // Regeneration should throw AND leave INDEX.md intact
    await expect(regenerateIndex(join(work, "specs"), { now: "2026-04-21T10:30:00Z" })).rejects.toThrow();
    const post = readFileSync(join(work, "specs", "INDEX.md"), "utf-8");
    expect(post).toBe(pre);
  });
});

describe("regenerateIndex — tracker ref (AC-40.4)", () => {
  test("renders tracker ref when frontmatter.tracker has a key", async () => {
    const full = join(work, "specs", "frs", "fr_01HZ0000000000000000000001.md");
    writeFileSync(
      full,
      [
        "---",
        "id: fr_01HZ0000000000000000000001",
        "title: Tracked",
        "milestone: M13",
        "status: active",
        "tracker:",
        "  linear: LIN-1234",
        "---",
        "",
        "## Requirement",
        "",
        "Body.",
        "",
      ].join("\n"),
    );
    await regenerateIndex(join(work, "specs"), { now: "2026-04-21T10:30:00Z" });
    const out = readFileSync(join(work, "specs", "INDEX.md"), "utf-8");
    expect(out).toContain("linear:LIN-1234");
  });
});

describe("regenerateIndex — empty tree", () => {
  test("writes an INDEX with header but no rows when no active FRs exist", async () => {
    await regenerateIndex(join(work, "specs"), { now: "2026-04-21T10:30:00Z" });
    const out = readFileSync(join(work, "specs", "INDEX.md"), "utf-8");
    expect(out).toContain("# Active FRs");
    expect(out).not.toContain("| [fr_");
    expect(out).toContain("Generated:");
    expect(existsSync(join(work, "specs", ".INDEX.md.tmp"))).toBe(false);
  });
});
