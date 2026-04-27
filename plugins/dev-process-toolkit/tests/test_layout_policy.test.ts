import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBunZeroMatchPlaceholderProbe } from "../adapters/_shared/src/bun_zero_match_placeholder";

// STE-128 AC-STE-128.5 — Probe #20 enforces the chosen test layout when
// `## Testing Conventions` in CLAUDE.md declares one (`co-location` or
// `mirror`). Absent block ⇒ permissive (backward compat for projects pre-M33).
//
// Fixtures:
//   (a) co-location declared + only src/*.test.ts → pass
//   (b) co-location declared + tests/foo.test.ts present → fail
//   (c) mirror declared + only tests/*.test.ts → pass
//   (d) mirror declared + src/foo.test.ts present → fail
//   (e) no `## Testing Conventions` block → permissive (existing behavior)

const pluginRoot = join(import.meta.dir, "..");

function makeProject(files: Record<string, string>): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "test-layout-"));
  for (const [path, content] of Object.entries(files)) {
    const dir = join(root, path.split("/").slice(0, -1).join("/"));
    if (dir !== root) mkdirSync(dir, { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const COLOC_CLAUDE_MD = [
  "# X",
  "",
  "## Testing Conventions",
  "",
  "- **Layout:** src/-co-located (each `src/foo.ts` has a sibling `src/foo.test.ts`).",
  "- **Framework:** bun:test",
  "",
].join("\n");

const MIRROR_CLAUDE_MD = [
  "# X",
  "",
  "## Testing Conventions",
  "",
  "- **Layout:** tests/-mirror (tests live under `tests/` mirroring `src/`).",
  "- **Framework:** bun:test",
  "",
].join("\n");

describe("AC-STE-128.5(a) co-location declared + only src/*.test.ts → pass", () => {
  test("no violations when layout matches policy", async () => {
    const ctx = makeProject({
      "bun.lock": "{}",
      "CLAUDE.md": COLOC_CLAUDE_MD,
      "src/foo.ts": "export const foo = 1;\n",
      "src/foo.test.ts": "import {test, expect} from 'bun:test';\ntest('x', () => expect(1).toBe(1));\n",
    });
    try {
      const report = await runBunZeroMatchPlaceholderProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-128.5(b) co-location declared + tests/foo.test.ts present → fail", () => {
  test("violation flags the offending tests/ file", async () => {
    const ctx = makeProject({
      "bun.lock": "{}",
      "CLAUDE.md": COLOC_CLAUDE_MD,
      "src/foo.ts": "export const foo = 1;\n",
      "tests/foo.test.ts": "import {test, expect} from 'bun:test';\ntest('x', () => expect(1).toBe(1));\n",
    });
    try {
      const report = await runBunZeroMatchPlaceholderProbe(ctx.root);
      expect(report.violations.length).toBeGreaterThanOrEqual(1);
      const layoutViolation = report.violations.find((v) =>
        v.note.includes("tests/foo.test.ts"),
      );
      expect(layoutViolation).toBeDefined();
      expect(layoutViolation!.note).toMatch(/co-loc|src\//i);
      expect(layoutViolation!.message).toMatch(/Remedy:/);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-128.5(c) mirror declared + only tests/*.test.ts → pass", () => {
  test("no violations when layout matches policy", async () => {
    const ctx = makeProject({
      "bun.lock": "{}",
      "CLAUDE.md": MIRROR_CLAUDE_MD,
      "src/foo.ts": "export const foo = 1;\n",
      "tests/foo.test.ts": "import {test, expect} from 'bun:test';\ntest('x', () => expect(1).toBe(1));\n",
    });
    try {
      const report = await runBunZeroMatchPlaceholderProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-128.5(d) mirror declared + src/foo.test.ts present → fail", () => {
  test("violation flags the co-located file as wrong layout", async () => {
    const ctx = makeProject({
      "bun.lock": "{}",
      "CLAUDE.md": MIRROR_CLAUDE_MD,
      "src/foo.ts": "export const foo = 1;\n",
      "src/foo.test.ts": "import {test, expect} from 'bun:test';\ntest('x', () => expect(1).toBe(1));\n",
    });
    try {
      const report = await runBunZeroMatchPlaceholderProbe(ctx.root);
      const layoutViolation = report.violations.find((v) =>
        v.note.includes("src/foo.test.ts"),
      );
      expect(layoutViolation).toBeDefined();
      expect(layoutViolation!.note).toMatch(/mirror|tests\//i);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-128.5 — HTML-comment example wording does NOT trigger layout enforcement", () => {
  test("legacy template comment mentioning both layouts is exempt", async () => {
    // Pre-M33 CLAUDE.md.template carried `<!-- e.g., tests/ mirrors src/, colocated with source -->`
    // as advisory wording. The probe must strip HTML comments before parsing the
    // Layout: line so that example phrasing doesn't decide policy.
    const ctx = makeProject({
      "bun.lock": "{}",
      "CLAUDE.md": [
        "# X",
        "",
        "## Testing Conventions",
        "",
        "<!-- Pre-M33 advisory: tests/ mirrors src/, colocated with source -->",
        "- **Framework:** bun:test",
        "<!-- another comment block: src/-co-located vs tests/-mirror — neither chosen here -->",
        "",
      ].join("\n"),
      "src/foo.test.ts": "import {test, expect} from 'bun:test';\ntest('x', () => expect(1).toBe(1));\n",
      "tests/bar.test.ts": "import {test, expect} from 'bun:test';\ntest('x', () => expect(1).toBe(1));\n",
    });
    try {
      // No `Layout:` line outside the comments → probe stays permissive.
      const report = await runBunZeroMatchPlaceholderProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });

  test("Layout outside comments wins; comment example with conflicting wording is ignored", async () => {
    const ctx = makeProject({
      "bun.lock": "{}",
      "CLAUDE.md": [
        "# X",
        "",
        "## Testing Conventions",
        "",
        "<!-- example: tests/ mirrors src/ -->",
        "- **Layout:** src/-co-located",
        "",
      ].join("\n"),
      "src/foo.test.ts": "import {test, expect} from 'bun:test';\ntest('x', () => expect(1).toBe(1));\n",
      "tests/bar.test.ts": "import {test, expect} from 'bun:test';\ntest('x', () => expect(1).toBe(1));\n",
    });
    try {
      const report = await runBunZeroMatchPlaceholderProbe(ctx.root);
      // co-location enforced → tests/bar.test.ts violates
      const violation = report.violations.find((v) => v.note.includes("tests/bar.test.ts"));
      expect(violation).toBeDefined();
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-128.5(e) no Testing Conventions block → permissive (backward compat)", () => {
  test("project without CLAUDE.md → no layout violation", async () => {
    const ctx = makeProject({
      "bun.lock": "{}",
      "src/foo.test.ts": "import {test, expect} from 'bun:test';\ntest('x', () => expect(1).toBe(1));\n",
      "tests/bar.test.ts": "import {test, expect} from 'bun:test';\ntest('x', () => expect(1).toBe(1));\n",
    });
    try {
      const report = await runBunZeroMatchPlaceholderProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });

  test("CLAUDE.md without `## Testing Conventions` block → no layout violation", async () => {
    const ctx = makeProject({
      "bun.lock": "{}",
      "CLAUDE.md": "# X\n\n## Other\nNo testing conventions block.\n",
      "src/foo.test.ts": "import {test, expect} from 'bun:test';\ntest('x', () => expect(1).toBe(1));\n",
      "tests/bar.test.ts": "import {test, expect} from 'bun:test';\ntest('x', () => expect(1).toBe(1));\n",
    });
    try {
      const report = await runBunZeroMatchPlaceholderProbe(ctx.root);
      expect(report.violations).toEqual([]);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-128.1 — docs/patterns.md documents the chosen layout", () => {
  test("patterns.md carries a Test layout policy section naming co-location", () => {
    const patterns = readFileSync(join(pluginRoot, "docs", "patterns.md"), "utf-8");
    expect(patterns).toMatch(/Test layout policy|test-layout-policy/i);
    expect(patterns).toMatch(/co-locat|src\//i);
  });
});

describe("AC-STE-128.2 — testing-spec.md.template § 2 reflects co-location", () => {
  test("template prescribes src/-co-located layout", () => {
    const tmpl = readFileSync(
      join(pluginRoot, "templates", "spec-templates", "testing-spec.md.template"),
      "utf-8",
    );
    expect(tmpl).toMatch(/co-locat|src\/foo\.test\.|src\/<module>\.test/i);
  });
});

describe("AC-STE-128.3 — CLAUDE.md.template Testing Conventions declares layout", () => {
  test("template carries `Layout:` prescription pointing at co-location", () => {
    const tmpl = readFileSync(
      join(pluginRoot, "templates", "CLAUDE.md.template"),
      "utf-8",
    );
    // The template's `## Testing Conventions` block must declare a Layout
    // line so probe #20 can enforce policy on downstream projects.
    expect(tmpl).toMatch(/Layout:.*co-locat|Layout:.*src\//i);
  });
});
