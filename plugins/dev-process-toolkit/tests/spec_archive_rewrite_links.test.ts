import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rewriteArchiveLinks } from "../adapters/_shared/src/spec_archive/rewrite_links";

// STE-111 AC-STE-111.1 / AC-STE-111.7 — rewrite_links helper.
//
// On archive, rewrite `frs/<id>.md` → `frs/archive/<id>.md` across:
//   - specs/requirements.md
//   - specs/plan/<M>.md (active milestone plan)
//   - specs/plan/archive/<M>.md (archived milestone plans)
//   - CHANGELOG.md (scoped: top-of-file → first dated `## [X.Y.Z]` header)
//
// Six fixtures:
//   (a) FR with traceability row in requirements.md → rewritten
//   (b) FR referenced in active plan → rewritten
//   (c) FR referenced in archived plan → rewritten
//   (d) FR referenced in unreleased CHANGELOG → rewritten
//   (e) FR referenced in released CHANGELOG → NOT rewritten
//   (f) Orphan FR (no references anywhere) → no rewrite, no error

function makeProject(files: Record<string, string>): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "rewrite-links-"));
  for (const [path, content] of Object.entries(files)) {
    const dir = join(root, path.split("/").slice(0, -1).join("/"));
    if (dir !== root) mkdirSync(dir, { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("AC-STE-111.7(a) requirements.md row → rewritten", () => {
  test("Markdown link `](frs/<id>.md)` rewritten to archive path", () => {
    const ctx = makeProject({
      "specs/requirements.md": `| STE-102 | Greeting helper | [link](frs/STE-102.md) |\n`,
    });
    try {
      const result = rewriteArchiveLinks(ctx.root, "STE-102");
      expect(result.filesChanged).toContain("specs/requirements.md");
      const after = readFileSync(join(ctx.root, "specs/requirements.md"), "utf-8");
      expect(after).toContain("frs/archive/STE-102.md");
      expect(after).not.toContain("](frs/STE-102.md)");
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-111.7(b) active plan reference → rewritten", () => {
  test("plan/<M>.md mentioning the archived FR rewritten", () => {
    const ctx = makeProject({
      "specs/plan/M29.md": `Plan body referencing [STE-102](../frs/STE-102.md).\n`,
    });
    try {
      const result = rewriteArchiveLinks(ctx.root, "STE-102");
      expect(result.filesChanged).toContain("specs/plan/M29.md");
      const after = readFileSync(join(ctx.root, "specs/plan/M29.md"), "utf-8");
      expect(after).toContain("frs/archive/STE-102.md");
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-111.7(c) archived plan reference → rewritten", () => {
  test("plan/archive/<M>.md mentioning the archived FR rewritten", () => {
    const ctx = makeProject({
      "specs/plan/archive/M28.md": `Body with frs/STE-102.md reference.\n`,
    });
    try {
      const result = rewriteArchiveLinks(ctx.root, "STE-102");
      expect(result.filesChanged).toContain("specs/plan/archive/M28.md");
      const after = readFileSync(join(ctx.root, "specs/plan/archive/M28.md"), "utf-8");
      expect(after).toContain("frs/archive/STE-102.md");
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-111.7(d) unreleased CHANGELOG → rewritten (above first dated header)", () => {
  test("references above the first `## [X.Y.Z] — YYYY-MM-DD` get rewritten", () => {
    const changelog = [
      "# Changelog",
      "",
      "Unreleased work references frs/STE-102.md.",
      "",
      "## [1.29.0] — 2026-04-25 — \"Runbook\"",
      "",
      "Released entry; references frs/STE-102.md should NOT be rewritten.",
      "",
    ].join("\n");
    const ctx = makeProject({ "CHANGELOG.md": changelog });
    try {
      const result = rewriteArchiveLinks(ctx.root, "STE-102");
      expect(result.filesChanged).toContain("CHANGELOG.md");
      const after = readFileSync(join(ctx.root, "CHANGELOG.md"), "utf-8");
      // First reference (above the dated header) → rewritten
      const aboveSplit = after.split("## [1.29.0]");
      expect(aboveSplit[0]).toContain("frs/archive/STE-102.md");
      // Below the dated header → frozen, untouched
      expect(aboveSplit[1]).toContain("frs/STE-102.md");
      expect(aboveSplit[1]).not.toContain("frs/archive/STE-102.md");
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-111.7(e) released CHANGELOG section frozen (no rewrite)", () => {
  test("references only inside released sections are not touched", () => {
    const changelog = [
      "# Changelog",
      "",
      "## [1.29.0] — 2026-04-25 — \"Runbook\"",
      "",
      "References frs/STE-102.md in shipped notes — frozen.",
      "",
      "## [1.28.0] — 2026-04-24",
      "",
      "frs/STE-102.md again here — also frozen.",
      "",
    ].join("\n");
    const ctx = makeProject({ "CHANGELOG.md": changelog });
    try {
      const result = rewriteArchiveLinks(ctx.root, "STE-102");
      expect(result.filesChanged).not.toContain("CHANGELOG.md");
      const after = readFileSync(join(ctx.root, "CHANGELOG.md"), "utf-8");
      expect(after).not.toContain("frs/archive/STE-102.md");
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-111.5(f) orphan FR → no error, empty filesChanged", () => {
  test("FR referenced nowhere → no rewrite, no error", () => {
    const ctx = makeProject({
      "specs/requirements.md": "Some unrelated body.\n",
      "specs/plan/M29.md": "Plan body unrelated.\n",
    });
    try {
      const result = rewriteArchiveLinks(ctx.root, "STE-999");
      expect(result.filesChanged).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-111.2 — both link forms covered (`](./frs/...)` and bare path)", () => {
  test("dotted relative link rewritten", () => {
    const ctx = makeProject({
      "specs/requirements.md": `See [link](./frs/STE-102.md) for details.\n`,
    });
    try {
      const result = rewriteArchiveLinks(ctx.root, "STE-102");
      expect(result.filesChanged).toContain("specs/requirements.md");
      const after = readFileSync(join(ctx.root, "specs/requirements.md"), "utf-8");
      expect(after).toContain("./frs/archive/STE-102.md");
    } finally {
      ctx.cleanup();
    }
  });

  test("bare path mention rewritten (no link wrapper)", () => {
    const ctx = makeProject({
      "specs/requirements.md": `Reference: frs/STE-102.md is canonical.\n`,
    });
    try {
      const result = rewriteArchiveLinks(ctx.root, "STE-102");
      expect(result.filesChanged).toContain("specs/requirements.md");
      const after = readFileSync(join(ctx.root, "specs/requirements.md"), "utf-8");
      expect(after).toContain("frs/archive/STE-102.md");
    } finally {
      ctx.cleanup();
    }
  });
});
