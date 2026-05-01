import { describe, expect, test } from "bun:test";
import { isFRUntrackedInPorcelain } from "../adapters/_shared/src/spec_archive/stage_untracked_fr";

// STE-171 AC-STE-171.2 — isFRUntrackedInPorcelain(porcelain, frPath) is the
// pure decision helper for the "git add before git mv" step. Phase 4
// § Milestone Archival runs `git status --porcelain <frPath>` and feeds the
// output here to decide whether to `git add` first. Untracked → add → preserve
// rename history under `git log --follow`.

describe("AC-STE-171.2 — isFRUntrackedInPorcelain detects ?? markers", () => {
  test("untracked path returns true", () => {
    const out = "?? specs/frs/STE-171.md\n";
    expect(isFRUntrackedInPorcelain(out, "specs/frs/STE-171.md")).toBe(true);
  });

  test("modified path (' M') returns false — already tracked", () => {
    const out = " M specs/frs/STE-171.md\n";
    expect(isFRUntrackedInPorcelain(out, "specs/frs/STE-171.md")).toBe(false);
  });

  test("staged-add path ('A ') returns false — already in index", () => {
    const out = "A  specs/frs/STE-171.md\n";
    expect(isFRUntrackedInPorcelain(out, "specs/frs/STE-171.md")).toBe(false);
  });

  test("empty porcelain output returns false (file is clean / not present)", () => {
    expect(isFRUntrackedInPorcelain("", "specs/frs/STE-171.md")).toBe(false);
  });

  test("unrelated untracked entry returns false", () => {
    const out = "?? specs/frs/STE-999.md\n";
    expect(isFRUntrackedInPorcelain(out, "specs/frs/STE-171.md")).toBe(false);
  });

  test("multi-line porcelain — only the matching ?? entry triggers true", () => {
    const out = [" M README.md", "?? specs/frs/STE-171.md", "?? other.txt", ""].join("\n");
    expect(isFRUntrackedInPorcelain(out, "specs/frs/STE-171.md")).toBe(true);
  });

  test("path with leading ./ in porcelain entry still matches", () => {
    const out = "?? ./specs/frs/STE-171.md\n";
    expect(isFRUntrackedInPorcelain(out, "specs/frs/STE-171.md")).toBe(true);
  });
});
