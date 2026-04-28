// M18 STE-61 AC-STE-61.6 — single-pattern (direct filename) lookup.
// STE-135 — post-STE-76 contract (`tracker:` block, no `id:` line) is the
// canonical shape now, so the lookup helper exercised here is the
// path-returning variant `findFRPathByTrackerRef`. The legacy
// `findFRByTrackerRef` retains its mode-none-only `id:`-returning behavior
// (covered by `adapters/_shared/src/resolve.test.ts`).

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findFRPathByTrackerRef } from "../adapters/_shared/src/resolve";

function makeSpecs(): { specsDir: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), "m18-single-"));
  const specsDir = join(root, "specs");
  mkdirSync(join(specsDir, "frs", "archive"), { recursive: true });
  return { specsDir, root };
}

function writeTrackerFR(
  dir: string,
  filename: string,
  frontmatter: { title?: string; tracker: Record<string, string> },
): void {
  const trackerLines = Object.entries(frontmatter.tracker)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join("\n");
  const trackerBlock = trackerLines.length > 0 ? `tracker:\n${trackerLines}\n` : "tracker: {}\n";
  writeFileSync(
    join(dir, filename),
    `---\ntitle: ${frontmatter.title ?? ""}\nmilestone: M1\nstatus: active\narchived_at: null\n${trackerBlock}---\n`,
  );
}

describe("AC-STE-135.7 — post-STE-76 lookup contract (tracker-mode, no id: line)", () => {
  test("post-STE-76 fixture (tracker.linear populated, no id:) resolves to the file path", async () => {
    const { specsDir, root } = makeSpecs();
    writeTrackerFR(join(specsDir, "frs"), "STE-100.md", {
      tracker: { linear: "STE-100" },
    });
    const hit = await findFRPathByTrackerRef(specsDir, "linear", "STE-100");
    expect(hit).toBe(join(specsDir, "frs", "STE-100.md"));
    rmSync(root, { recursive: true, force: true });
  });

  test("archived post-STE-76 fixture resolves when includeArchive is set", async () => {
    const { specsDir, root } = makeSpecs();
    writeTrackerFR(join(specsDir, "frs", "archive"), "STE-42.md", {
      tracker: { linear: "STE-42" },
    });
    const hit = await findFRPathByTrackerRef(specsDir, "linear", "STE-42", {
      includeArchive: true,
    });
    expect(hit).toBe(join(specsDir, "frs", "archive", "STE-42.md"));
    rmSync(root, { recursive: true, force: true });
  });

  test("archived FR is excluded by default (matches findFRByTrackerRef semantics)", async () => {
    const { specsDir, root } = makeSpecs();
    writeTrackerFR(join(specsDir, "frs", "archive"), "STE-42.md", {
      tracker: { linear: "STE-42" },
    });
    expect(await findFRPathByTrackerRef(specsDir, "linear", "STE-42")).toBeNull();
    rmSync(root, { recursive: true, force: true });
  });

  test("legacy fr_<ULID>.md filename does NOT resolve via scan (Phase 2 retired)", async () => {
    const { specsDir, root } = makeSpecs();
    // Only a legacy-named file exists. The resolver must return null rather
    // than walking the directory to find it.
    writeTrackerFR(join(specsDir, "frs"), "fr_01LEGACYNAMEDFR0000000001.md", {
      tracker: { linear: "STE-42" },
    });
    expect(await findFRPathByTrackerRef(specsDir, "linear", "STE-42")).toBeNull();
    rmSync(root, { recursive: true, force: true });
  });

  test("filename claims tracker ref but frontmatter disagrees → null (no silent mismatch)", async () => {
    const { specsDir, root } = makeSpecs();
    writeTrackerFR(join(specsDir, "frs"), "STE-60.md", {
      tracker: { linear: "STE-99" }, // frontmatter disagrees with filename
    });
    expect(await findFRPathByTrackerRef(specsDir, "linear", "STE-60")).toBeNull();
    rmSync(root, { recursive: true, force: true });
  });

  test("no matching file → null", async () => {
    const { specsDir, root } = makeSpecs();
    expect(await findFRPathByTrackerRef(specsDir, "linear", "STE-999")).toBeNull();
    rmSync(root, { recursive: true, force: true });
  });

  test("different tracker key does not match", async () => {
    const { specsDir, root } = makeSpecs();
    writeTrackerFR(join(specsDir, "frs"), "STE-60.md", {
      tracker: { linear: "STE-60" },
    });
    expect(await findFRPathByTrackerRef(specsDir, "jira", "STE-60")).toBeNull();
    rmSync(root, { recursive: true, force: true });
  });
});
