// STE-465 AC-STE-465.{1,2,3} — best-practices manifest helpers.
//
// Asserts the public surface of
// `plugins/dev-process-toolkit/adapters/_shared/src/best_practices_manifest.ts`
// — the STE-301 deps-manifest idiom cloned verbatim (fix-the-quiet-half
// lesson: reuse the existing idiom, do not abstract):
//
//   readManifest(specsDir)               → { best_practices: Entry[] }
//   writeManifest(specsDir, manifest)    → void (round-trip via readback)
//   addEntry(manifest, entry)            → mutated manifest, throws on collision
//   removeEntry(manifest, name)          → mutated manifest, throws on missing
//   findEntry(manifest, name)            → Entry | undefined
//   class BestPracticesManifestShapeError → NFR-10 canonical refusal shape
//
// Manifest file: `specs/best-practices.yaml`, top-level key
// `best_practices:` (empty form `best_practices: []`). Entry schema:
//   { name: string, path: string, scope?: string[] (globs),
//     topics?: string[], notes?: string }
//
// Deliberate divergences from the deps twin, per the ACs:
//   - CLOSED schema: unknown entry keys REFUSE (deps ignores them).
//   - `path` is REPO-RELATIVE: no absolute paths, no `../` escape
//     (deps is sibling-only `../`-prefixed — the exact inverse).
//
// Filter by AC with `bun test -t "AC-STE-465.N"`.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addEntry,
  BestPracticesManifestShapeError,
  findEntry,
  readManifest,
  removeEntry,
  writeManifest,
  type BestPracticesEntry,
  type BestPracticesManifest,
} from "../adapters/_shared/src/best_practices_manifest";

function makeSpecsDir(): { specsDir: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "best-practices-manifest-"));
  const specsDir = join(root, "specs");
  mkdirSync(specsDir, { recursive: true });
  return { specsDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function writeRawManifest(specsDir: string, body: string): void {
  writeFileSync(join(specsDir, "best-practices.yaml"), body);
}

// -----------------------------------------------------------------------------
// AC-STE-465.1 — readManifest: absent / empty / valid
// -----------------------------------------------------------------------------

describe("AC-STE-465.1 — readManifest on absent file", () => {
  test("absent file ≡ empty manifest (no throw)", () => {
    const { specsDir, cleanup } = makeSpecsDir();
    try {
      const m = readManifest(specsDir);
      expect(m.best_practices).toEqual([]);
    } finally {
      cleanup();
    }
  });
});

describe("AC-STE-465.1 — readManifest on empty manifest", () => {
  test("zero-entry manifest `best_practices: []` is valid", () => {
    const { specsDir, cleanup } = makeSpecsDir();
    try {
      writeRawManifest(specsDir, "best_practices: []\n");
      const m = readManifest(specsDir);
      expect(m.best_practices).toEqual([]);
    } finally {
      cleanup();
    }
  });
});

describe("AC-STE-465.1 — readManifest on valid manifest", () => {
  test("parses all entry fields including scope/topics/notes", () => {
    const { specsDir, cleanup } = makeSpecsDir();
    try {
      writeRawManifest(
        specsDir,
        [
          "best_practices:",
          "  - name: error-handling",
          "    path: docs/best-practices/error-handling.md",
          '    scope: ["src/**/*.ts", "adapters/**"]',
          "    topics: [errors, logging]",
          "    notes: house rules for throw vs. return",
          "",
        ].join("\n"),
      );
      const m = readManifest(specsDir);
      expect(m.best_practices.length).toBe(1);
      const e = m.best_practices[0]!;
      expect(e.name).toBe("error-handling");
      expect(e.path).toBe("docs/best-practices/error-handling.md");
      expect(e.scope).toEqual(["src/**/*.ts", "adapters/**"]);
      expect(e.topics).toEqual(["errors", "logging"]);
      expect(e.notes).toBe("house rules for throw vs. return");
    } finally {
      cleanup();
    }
  });

  test("scope, topics, and notes are optional — absent reads as undefined", () => {
    const { specsDir, cleanup } = makeSpecsDir();
    try {
      writeRawManifest(
        specsDir,
        [
          "best_practices:",
          "  - name: bare",
          "    path: docs/bare.md",
          "",
        ].join("\n"),
      );
      const m = readManifest(specsDir);
      expect(m.best_practices.length).toBe(1);
      expect(m.best_practices[0]!.name).toBe("bare");
      expect(m.best_practices[0]!.scope).toBeUndefined();
      expect(m.best_practices[0]!.topics).toBeUndefined();
      expect(m.best_practices[0]!.notes).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  test("empty flow list `topics: []` reads as an empty array, not undefined", () => {
    const { specsDir, cleanup } = makeSpecsDir();
    try {
      writeRawManifest(
        specsDir,
        [
          "best_practices:",
          "  - name: empty-topics",
          "    path: docs/empty-topics.md",
          "    topics: []",
          "",
        ].join("\n"),
      );
      const m = readManifest(specsDir);
      expect(m.best_practices[0]!.topics).toEqual([]);
    } finally {
      cleanup();
    }
  });

  test("duplicate entry names refuse at read time (uniqueness invariant, deps idiom)", () => {
    const { specsDir, cleanup } = makeSpecsDir();
    try {
      writeRawManifest(
        specsDir,
        [
          "best_practices:",
          "  - name: twice",
          "    path: docs/a.md",
          "  - name: twice",
          "    path: docs/b.md",
          "",
        ].join("\n"),
      );
      expect(() => readManifest(specsDir)).toThrow(BestPracticesManifestShapeError);
    } finally {
      cleanup();
    }
  });
});

// -----------------------------------------------------------------------------
// AC-STE-465.2 — malformed manifest ⇒ shape error, never silent skip / partial
// -----------------------------------------------------------------------------

describe("AC-STE-465.2 — readManifest on malformed manifest", () => {
  test("garbage body throws BestPracticesManifestShapeError", () => {
    const { specsDir, cleanup } = makeSpecsDir();
    try {
      writeRawManifest(specsDir, "best_practices: [unclosed\n  - bad");
      expect(() => readManifest(specsDir)).toThrow(BestPracticesManifestShapeError);
    } finally {
      cleanup();
    }
  });

  test("empty file throws (present-but-empty is NOT the empty manifest)", () => {
    const { specsDir, cleanup } = makeSpecsDir();
    try {
      writeRawManifest(specsDir, "");
      expect(() => readManifest(specsDir)).toThrow(BestPracticesManifestShapeError);
    } finally {
      cleanup();
    }
  });

  test("comments-and-blank-lines-only file throws (no `best_practices:` key)", () => {
    const { specsDir, cleanup } = makeSpecsDir();
    try {
      writeRawManifest(specsDir, "# just a comment\n\n# another\n");
      expect(() => readManifest(specsDir)).toThrow(BestPracticesManifestShapeError);
    } finally {
      cleanup();
    }
  });

  test("non-flow-style list value throws (only `[a, b]` flow lists are supported)", () => {
    const { specsDir, cleanup } = makeSpecsDir();
    try {
      writeRawManifest(
        specsDir,
        [
          "best_practices:",
          "  - name: blocky",
          "    path: docs/blocky.md",
          "    topics: errors, logging",
          "",
        ].join("\n"),
      );
      expect(() => readManifest(specsDir)).toThrow(BestPracticesManifestShapeError);
    } finally {
      cleanup();
    }
  });

  test("wrong top-level key throws (never treated as empty)", () => {
    const { specsDir, cleanup } = makeSpecsDir();
    try {
      writeRawManifest(specsDir, "practices:\n  - name: x\n    path: docs/x.md\n");
      expect(() => readManifest(specsDir)).toThrow(BestPracticesManifestShapeError);
    } finally {
      cleanup();
    }
  });

  test("entry missing required field `name` throws", () => {
    const { specsDir, cleanup } = makeSpecsDir();
    try {
      writeRawManifest(
        specsDir,
        ["best_practices:", "  - path: docs/nameless.md", ""].join("\n"),
      );
      expect(() => readManifest(specsDir)).toThrow(BestPracticesManifestShapeError);
    } finally {
      cleanup();
    }
  });

  test("entry missing required field `path` throws", () => {
    const { specsDir, cleanup } = makeSpecsDir();
    try {
      writeRawManifest(
        specsDir,
        ["best_practices:", "  - name: pathless", ""].join("\n"),
      );
      expect(() => readManifest(specsDir)).toThrow(BestPracticesManifestShapeError);
    } finally {
      cleanup();
    }
  });

  test("NEVER a partial parse: one good + one bad entry throws — the good entry is not returned", () => {
    const { specsDir, cleanup } = makeSpecsDir();
    try {
      writeRawManifest(
        specsDir,
        [
          "best_practices:",
          "  - name: good",
          "    path: docs/good.md",
          "  - name: bad-entry",
          "",
        ].join("\n"),
      );
      // The whole read refuses — a silent skip of `bad-entry` (returning only
      // `good`) is exactly the quiet half AC-STE-465.2 forbids.
      expect(() => readManifest(specsDir)).toThrow(BestPracticesManifestShapeError);
    } finally {
      cleanup();
    }
  });

  test("error message carries the NFR-10 canonical refusal shape (Refusing / Remedy / Context)", () => {
    const { specsDir, cleanup } = makeSpecsDir();
    try {
      writeRawManifest(specsDir, "not-a-manifest\n");
      let caught: unknown;
      try {
        readManifest(specsDir);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(BestPracticesManifestShapeError);
      const msg = (caught as Error).message;
      expect(msg).toMatch(/^Refusing: /m);
      expect(msg).toMatch(/^Remedy: /m);
      expect(msg).toMatch(/^Context: /m);
    } finally {
      cleanup();
    }
  });

  test("error.name is `BestPracticesManifestShapeError` (canonical class name)", () => {
    const err = new BestPracticesManifestShapeError("test");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("BestPracticesManifestShapeError");
  });
});

// -----------------------------------------------------------------------------
// AC-STE-465.3 — closed schema + repo-relative path constraint
// -----------------------------------------------------------------------------

describe("AC-STE-465.3 — closed schema: unknown entry keys refuse", () => {
  test("entry with an unknown key `owner` throws at read time", () => {
    const { specsDir, cleanup } = makeSpecsDir();
    try {
      writeRawManifest(
        specsDir,
        [
          "best_practices:",
          "  - name: sneaky",
          "    path: docs/sneaky.md",
          "    owner: bob",
          "",
        ].join("\n"),
      );
      expect(() => readManifest(specsDir)).toThrow(BestPracticesManifestShapeError);
    } finally {
      cleanup();
    }
  });
});

describe("AC-STE-465.3 — path must be repo-relative", () => {
  test("absolute path refuses at read time", () => {
    const { specsDir, cleanup } = makeSpecsDir();
    try {
      writeRawManifest(
        specsDir,
        [
          "best_practices:",
          "  - name: abs",
          "    path: /etc/passwd",
          "",
        ].join("\n"),
      );
      expect(() => readManifest(specsDir)).toThrow(BestPracticesManifestShapeError);
    } finally {
      cleanup();
    }
  });

  test("leading `../` escape refuses at read time", () => {
    const { specsDir, cleanup } = makeSpecsDir();
    try {
      writeRawManifest(
        specsDir,
        [
          "best_practices:",
          "  - name: escape",
          "    path: ../outside.md",
          "",
        ].join("\n"),
      );
      expect(() => readManifest(specsDir)).toThrow(BestPracticesManifestShapeError);
    } finally {
      cleanup();
    }
  });

  test("embedded `..` traversal segment refuses at read time", () => {
    const { specsDir, cleanup } = makeSpecsDir();
    try {
      writeRawManifest(
        specsDir,
        [
          "best_practices:",
          "  - name: sneak-out",
          "    path: docs/../../outside.md",
          "",
        ].join("\n"),
      );
      expect(() => readManifest(specsDir)).toThrow(BestPracticesManifestShapeError);
    } finally {
      cleanup();
    }
  });

  test("nested repo-relative path is accepted", () => {
    const { specsDir, cleanup } = makeSpecsDir();
    try {
      writeRawManifest(
        specsDir,
        [
          "best_practices:",
          "  - name: nested",
          "    path: docs/best-practices/deep/rules.md",
          "",
        ].join("\n"),
      );
      const m = readManifest(specsDir);
      expect(m.best_practices[0]!.path).toBe("docs/best-practices/deep/rules.md");
    } finally {
      cleanup();
    }
  });

  test("addEntry rejects absolute path (same guard at mutation time)", () => {
    const m: BestPracticesManifest = { best_practices: [] };
    expect(() =>
      addEntry(m, { name: "abs", path: "/abs/rules.md" }),
    ).toThrow(BestPracticesManifestShapeError);
  });

  test("addEntry rejects `../` escape path (same guard at mutation time)", () => {
    const m: BestPracticesManifest = { best_practices: [] };
    expect(() =>
      addEntry(m, { name: "escape", path: "../rules.md" }),
    ).toThrow(BestPracticesManifestShapeError);
  });
});

// -----------------------------------------------------------------------------
// AC-STE-465.1 — addEntry / removeEntry / findEntry mutators
// -----------------------------------------------------------------------------

describe("AC-STE-465.1 — addEntry collision detection (NFR-10 canonical refusal)", () => {
  test("adding an entry whose name collides ⇒ BestPracticesManifestShapeError", () => {
    const m: BestPracticesManifest = {
      best_practices: [{ name: "errors", path: "docs/errors.md" }],
    };
    expect(() =>
      addEntry(m, { name: "errors", path: "docs/other.md" }),
    ).toThrow(BestPracticesManifestShapeError);
  });

  test("adding a unique entry appends", () => {
    const m: BestPracticesManifest = { best_practices: [] };
    const out = addEntry(m, { name: "fresh", path: "docs/fresh.md" });
    expect(out.best_practices.length).toBe(1);
    expect(out.best_practices[0]!.name).toBe("fresh");
  });
});

describe("AC-STE-465.1 — removeEntry / findEntry", () => {
  test("removing a name not in the manifest ⇒ BestPracticesManifestShapeError", () => {
    const m: BestPracticesManifest = {
      best_practices: [{ name: "errors", path: "docs/errors.md" }],
    };
    expect(() => removeEntry(m, "missing")).toThrow(BestPracticesManifestShapeError);
  });

  test("removeEntry on present name removes exactly it", () => {
    const m: BestPracticesManifest = {
      best_practices: [
        { name: "errors", path: "docs/errors.md" },
        { name: "logging", path: "docs/logging.md" },
      ],
    };
    const out = removeEntry(m, "errors");
    expect(out.best_practices.length).toBe(1);
    expect(out.best_practices[0]!.name).toBe("logging");
  });

  test("findEntry returns the matching entry", () => {
    const m: BestPracticesManifest = {
      best_practices: [
        { name: "errors", path: "docs/errors.md" },
        { name: "logging", path: "docs/logging.md" },
      ],
    };
    const e = findEntry(m, "logging");
    expect(e).toBeDefined();
    expect(e!.path).toBe("docs/logging.md");
  });

  test("findEntry returns undefined for missing name (does NOT throw)", () => {
    const m: BestPracticesManifest = { best_practices: [] };
    expect(findEntry(m, "ghost")).toBeUndefined();
  });
});

// -----------------------------------------------------------------------------
// AC-STE-465.1 — writeManifest round-trip
// -----------------------------------------------------------------------------

describe("AC-STE-465.1 — writeManifest round-trip via readManifest", () => {
  test("write then read returns the same entries (all fields survive)", () => {
    const { specsDir, cleanup } = makeSpecsDir();
    try {
      const m: BestPracticesManifest = {
        best_practices: [
          {
            name: "errors",
            path: "docs/best-practices/errors.md",
            scope: ["src/**/*.ts", "adapters/**"],
            topics: ["errors", "logging"],
            notes: "throw, never swallow",
          },
          { name: "naming", path: "docs/best-practices/naming.md" },
        ],
      };
      writeManifest(specsDir, m);
      const round = readManifest(specsDir);
      expect(round.best_practices.length).toBe(2);
      const first = round.best_practices[0]!;
      expect(first.name).toBe("errors");
      expect(first.path).toBe("docs/best-practices/errors.md");
      expect(first.scope).toEqual(["src/**/*.ts", "adapters/**"]);
      expect(first.topics).toEqual(["errors", "logging"]);
      expect(first.notes).toBe("throw, never swallow");
      const second = round.best_practices[1]!;
      expect(second.name).toBe("naming");
      expect(second.scope).toBeUndefined();
      expect(second.topics).toBeUndefined();
      expect(second.notes).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  test("empty manifest round-trips as the canonical empty form", () => {
    const { specsDir, cleanup } = makeSpecsDir();
    try {
      writeManifest(specsDir, { best_practices: [] });
      const round = readManifest(specsDir);
      expect(round.best_practices).toEqual([]);
    } finally {
      cleanup();
    }
  });
});
