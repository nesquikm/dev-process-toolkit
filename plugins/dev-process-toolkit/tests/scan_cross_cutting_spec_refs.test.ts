// STE-215 — scanCrossCuttingSpecRefs helper.
//
// Given a removed path and a specsDir, return the list of references in
// `specs/technical-spec.md` and `specs/testing-spec.md` that mention
// either the basename or the relative path. Two reference shapes:
//   1. Directory-tree leaf — line inside a triple-backtick fence,
//      tree-character-prefixed, content is a leaf naming the path.
//   2. Prose mention — line outside any fence that names the path.
//
// /implement Phase 4 uses the helper to clean directory-tree leaves
// automatically; prose mentions are flagged for human review (commit
// message lists them; the operator amends if needed).

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanCrossCuttingSpecRefs } from "../adapters/_shared/src/scan_cross_cutting_spec_refs";

function makeFixture(opts: {
  technicalSpec?: string;
  testingSpec?: string;
}): { specsDir: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "scan-cross-cutting-"));
  const specsDir = join(root, "specs");
  mkdirSync(specsDir, { recursive: true });
  if (opts.technicalSpec !== undefined) {
    writeFileSync(join(specsDir, "technical-spec.md"), opts.technicalSpec);
  }
  if (opts.testingSpec !== undefined) {
    writeFileSync(join(specsDir, "testing-spec.md"), opts.testingSpec);
  }
  return { specsDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("AC-STE-215.1 — detection covers fenced directory-tree leaves and prose mentions", () => {
  test("directory-tree leaf inside ``` fence ⇒ technicalSpec hit (treeLeaf)", () => {
    const fx = makeFixture({
      technicalSpec: [
        "# Technical Spec",
        "",
        "```",
        "src/",
        "├── greet.ts",
        "└── .placeholder.test.ts",
        "```",
        "",
      ].join("\n"),
    });
    try {
      const r = scanCrossCuttingSpecRefs("src/.placeholder.test.ts", fx.specsDir);
      expect(r.technicalSpec.length).toBeGreaterThan(0);
      const first = r.technicalSpec[0]!;
      expect(first.kind).toBe("treeLeaf");
      expect(first.line).toBeGreaterThan(0);
    } finally {
      fx.cleanup();
    }
  });

  test("prose mention outside any fence ⇒ proseMention hit (testingSpec)", () => {
    const fx = makeFixture({
      testingSpec: [
        "# Testing Spec",
        "",
        "We delete `.placeholder.test.ts` once the first real test ships.",
        "",
      ].join("\n"),
    });
    try {
      const r = scanCrossCuttingSpecRefs("src/.placeholder.test.ts", fx.specsDir);
      expect(r.testingSpec.length).toBeGreaterThan(0);
      const first = r.testingSpec[0]!;
      expect(first.kind).toBe("proseMention");
    } finally {
      fx.cleanup();
    }
  });

  test("basename match works even when prose carries no directory prefix", () => {
    const fx = makeFixture({
      testingSpec: [
        "# Testing Spec",
        "",
        "Note: `.placeholder.test.ts` is a Bun zero-match workaround.",
        "",
      ].join("\n"),
    });
    try {
      const r = scanCrossCuttingSpecRefs("src/.placeholder.test.ts", fx.specsDir);
      expect(r.testingSpec.length).toBeGreaterThan(0);
    } finally {
      fx.cleanup();
    }
  });
});

describe("AC-STE-215.4 — silent no-op on zero matches", () => {
  test("no references in either file ⇒ both lists empty", () => {
    const fx = makeFixture({
      technicalSpec: "# Technical Spec\n\nNothing here.\n",
      testingSpec: "# Testing Spec\n\nNothing here.\n",
    });
    try {
      const r = scanCrossCuttingSpecRefs("src/.placeholder.test.ts", fx.specsDir);
      expect(r.technicalSpec).toEqual([]);
      expect(r.testingSpec).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("missing technical-spec.md / testing-spec.md ⇒ no error, empty result", () => {
    const fx = makeFixture({});
    try {
      const r = scanCrossCuttingSpecRefs("src/.placeholder.test.ts", fx.specsDir);
      expect(r.technicalSpec).toEqual([]);
      expect(r.testingSpec).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });
});

describe("idempotence (re-running on a cleaned tree is a no-op)", () => {
  test("scanning a spec set with the references already removed produces empty result", () => {
    const fx = makeFixture({
      technicalSpec: [
        "# Technical Spec",
        "",
        "```",
        "src/",
        "└── greet.ts",
        "```",
        "",
      ].join("\n"),
      testingSpec: "# Testing Spec\n",
    });
    try {
      const r = scanCrossCuttingSpecRefs("src/.placeholder.test.ts", fx.specsDir);
      expect(r.technicalSpec).toEqual([]);
      expect(r.testingSpec).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });
});

describe("snippet capture", () => {
  test("each hit returns the original line as snippet for human review", () => {
    const fx = makeFixture({
      technicalSpec: [
        "# Technical Spec",
        "",
        "```",
        "src/",
        "└── .placeholder.test.ts",
        "```",
        "",
      ].join("\n"),
    });
    try {
      const r = scanCrossCuttingSpecRefs("src/.placeholder.test.ts", fx.specsDir);
      expect(r.technicalSpec.length).toBeGreaterThan(0);
      expect(r.technicalSpec[0]!.snippet).toContain(".placeholder.test.ts");
    } finally {
      fx.cleanup();
    }
  });
});
