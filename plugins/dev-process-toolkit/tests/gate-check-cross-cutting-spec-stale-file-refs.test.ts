// STE-215 AC-STE-215.5 — /gate-check probe
// `cross-cutting-spec-stale-file-refs`. Severity: warning (NotesOnly).
//
// Walks `specs/technical-spec.md` and `specs/testing-spec.md` for path-
// references inside triple-backtick directory-tree blocks that don't
// resolve to an existing file on disk. Defense-in-depth read-side check
// for paths that bypass /implement's propagation step (manual deletes,
// `git rm`, downstream toolkit consumers).

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCrossCuttingSpecStaleFileRefsProbe } from "../adapters/_shared/src/cross_cutting_spec_stale_file_refs";

function makeFixture(opts: {
  technicalSpec?: string;
  testingSpec?: string;
  /**
   * Files to seed on disk under projectRoot/<path>. The probe asserts
   * referenced paths exist; seeding lets us write fixtures whose tree
   * leaves DO resolve.
   */
  seed?: { path: string; content: string }[];
}): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "cc-stale-refs-"));
  const specs = join(root, "specs");
  mkdirSync(specs, { recursive: true });
  if (opts.technicalSpec !== undefined) {
    writeFileSync(join(specs, "technical-spec.md"), opts.technicalSpec);
  }
  if (opts.testingSpec !== undefined) {
    writeFileSync(join(specs, "testing-spec.md"), opts.testingSpec);
  }
  for (const f of opts.seed ?? []) {
    const abs = join(root, f.path);
    const dir = abs.split("/").slice(0, -1).join("/");
    mkdirSync(dir, { recursive: true });
    writeFileSync(abs, f.content);
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("AC-STE-215.5 — stale-file-ref detection", () => {
  test("directory-tree leaf points at non-existent path ⇒ ADVISORY (not GATE FAILED)", async () => {
    const fx = makeFixture({
      technicalSpec: [
        "# Technical Spec",
        "",
        "```",
        "src/",
        "└── src/nonexistent/missing-file.ts",
        "```",
        "",
      ].join("\n"),
    });
    try {
      const r = await runCrossCuttingSpecStaleFileRefsProbe(fx.root);
      expect(r.violations.length).toBeGreaterThan(0);
      // Severity must be `warning` — never blocks the gate.
      expect(r.violations[0]!.severity).toBe("warning");
    } finally {
      fx.cleanup();
    }
  });

  test("clean tree (every full-path leaf resolves) ⇒ zero violations", async () => {
    const fx = makeFixture({
      technicalSpec: [
        "# Technical Spec",
        "",
        "```",
        "src/",
        "└── src/greet.ts",
        "```",
        "",
      ].join("\n"),
      seed: [{ path: "src/greet.ts", content: "export const greet = 'hi';\n" }],
    });
    try {
      const r = await runCrossCuttingSpecStaleFileRefsProbe(fx.root);
      const offending = r.violations.filter((v) => v.note.includes("src/greet.ts"));
      expect(offending).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("bare-basename leaf (no `/`) is NOT flagged — heuristic skip", async () => {
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
    });
    try {
      const r = await runCrossCuttingSpecStaleFileRefsProbe(fx.root);
      // Bare basenames in a tree carry no parent context — the probe
      // skips them to avoid false positives.
      expect(r.violations.filter((v) => v.note.includes("greet.ts"))).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("missing technical-spec.md / testing-spec.md ⇒ vacuous pass", async () => {
    const fx = makeFixture({});
    try {
      const r = await runCrossCuttingSpecStaleFileRefsProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("note + message reference both the file and the missing path", async () => {
    const fx = makeFixture({
      testingSpec: [
        "# Testing Spec",
        "",
        "```",
        "tests/",
        "└── tests/fixtures/ghost.test.ts",
        "```",
        "",
      ].join("\n"),
    });
    try {
      const r = await runCrossCuttingSpecStaleFileRefsProbe(fx.root);
      expect(r.violations.length).toBeGreaterThan(0);
      const v = r.violations[0]!;
      expect(v.message).toContain("cross_cutting_spec_stale_file_refs");
      expect(v.note).toContain("testing-spec.md");
      expect(v.note).toContain("tests/fixtures/ghost.test.ts");
    } finally {
      fx.cleanup();
    }
  });

  test("prose mentions outside fences are NOT flagged", async () => {
    const fx = makeFixture({
      technicalSpec: [
        "# Technical Spec",
        "",
        "We deliberately removed `src/old-helper.ts` last quarter.",
        "",
      ].join("\n"),
    });
    try {
      const r = await runCrossCuttingSpecStaleFileRefsProbe(fx.root);
      // Prose mentions are operator judgment surface — the probe must
      // not flag them. Only directory-tree leaves (inside fences) count.
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("URL-shaped tokens inside fences are NOT flagged", async () => {
    const fx = makeFixture({
      technicalSpec: [
        "# Technical Spec",
        "",
        "```",
        "# canonical config",
        "registry: https://example.com/foo.json",
        "```",
        "",
      ].join("\n"),
    });
    try {
      const r = await runCrossCuttingSpecStaleFileRefsProbe(fx.root);
      // URLs are not local paths — must not trigger the probe.
      expect(r.violations.filter((v) => v.note.includes("foo.json"))).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });
});
