// M18 STE-61 AC-STE-61.6 — findFRByTrackerRef is single-pattern.
//
// After STE-61's one-time rewrite retired the Phase 2 frontmatter-scan
// fallback, the resolver ONLY reads `<specsDir>/frs/<trackerId>.md` (+ the
// archive mirror). A legacy ULID-named file must NOT resolve via scan —
// the resolver refuses to paper over pre-M18 data.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findFRByTrackerRef } from "../adapters/_shared/src/resolve";

function makeSpecs(): { specsDir: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), "m18-single-"));
  const specsDir = join(root, "specs");
  mkdirSync(join(specsDir, "frs", "archive"), { recursive: true });
  return { specsDir, root };
}

function writeFR(dir: string, filename: string, frontmatter: Record<string, unknown>): void {
  const tracker = (frontmatter["tracker"] ?? {}) as Record<string, unknown>;
  const trackerLines = Object.entries(tracker)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join("\n");
  const trackerBlock = trackerLines.length > 0 ? `tracker:\n${trackerLines}\n` : "tracker: {}\n";
  writeFileSync(
    join(dir, filename),
    `---\nid: ${frontmatter["id"]}\ntitle: ${frontmatter["title"] ?? ""}\n${trackerBlock}---\n`,
  );
}

describe("AC-STE-61.6 — resolver is single-pattern (direct filename only)", () => {
  test("new-convention filename resolves directly", async () => {
    const { specsDir, root } = makeSpecs();
    writeFR(join(specsDir, "frs"), "STE-60.md", {
      id: "fr_01KPWPMA9TKSYYBNCQ3TAYM9BE",
      tracker: { linear: "STE-60" },
    });
    expect(await findFRByTrackerRef(specsDir, "linear", "STE-60")).toBe(
      "fr_01KPWPMA9TKSYYBNCQ3TAYM9BE",
    );
    rmSync(root, { recursive: true, force: true });
  });

  test("archived new-convention filename resolves directly when includeArchive is set", async () => {
    const { specsDir, root } = makeSpecs();
    writeFR(join(specsDir, "frs", "archive"), "STE-42.md", {
      id: "fr_01KPARCHIVED00000000000001",
      tracker: { linear: "STE-42" },
    });
    expect(await findFRByTrackerRef(specsDir, "linear", "STE-42", { includeArchive: true })).toBe(
      "fr_01KPARCHIVED00000000000001",
    );
    rmSync(root, { recursive: true, force: true });
  });

  test("legacy fr_<ULID>.md filename does NOT resolve via scan (Phase 2 retired)", async () => {
    const { specsDir, root } = makeSpecs();
    // Only a legacy-named file exists. The resolver must return null rather
    // than walking the directory to find it.
    writeFR(join(specsDir, "frs"), "fr_01LEGACYNAMEDFR0000000001.md", {
      id: "fr_01LEGACYNAMEDFR0000000001",
      tracker: { linear: "STE-42" },
    });
    expect(await findFRByTrackerRef(specsDir, "linear", "STE-42")).toBeNull();
    rmSync(root, { recursive: true, force: true });
  });

  test("legacy-named archived file also not resolvable by tracker ID (no fallback scan)", async () => {
    const { specsDir, root } = makeSpecs();
    writeFR(join(specsDir, "frs", "archive"), "fr_01LEGACYARCHIVED0000000001.md", {
      id: "fr_01LEGACYARCHIVED0000000001",
      tracker: { linear: "STE-42" },
    });
    expect(
      await findFRByTrackerRef(specsDir, "linear", "STE-42", { includeArchive: true }),
    ).toBeNull();
    rmSync(root, { recursive: true, force: true });
  });

  test("filename claims tracker ref but frontmatter disagrees → null (no silent mismatch)", async () => {
    const { specsDir, root } = makeSpecs();
    writeFR(join(specsDir, "frs"), "STE-60.md", {
      id: "fr_01KPMISMATCH000000000000001",
      tracker: { linear: "STE-99" }, // frontmatter disagrees with filename
    });
    expect(await findFRByTrackerRef(specsDir, "linear", "STE-60")).toBeNull();
    rmSync(root, { recursive: true, force: true });
  });

  test("no matching file → null", async () => {
    const { specsDir, root } = makeSpecs();
    expect(await findFRByTrackerRef(specsDir, "linear", "STE-999")).toBeNull();
    rmSync(root, { recursive: true, force: true });
  });
});
