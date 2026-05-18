// STE-301 AC-STE-301.1 / AC-STE-301.2 — dependency manifest helpers.
//
// Asserts the public surface of
// `plugins/dev-process-toolkit/adapters/_shared/src/deps_manifest.ts`:
//
//   readManifest(specsDir)               → { deps: Entry[] }
//   writeManifest(specsDir, manifest)    → void (round-trip via readback)
//   addEntry(manifest, entry)            → mutated manifest, throws on collision
//   removeEntry(manifest, name)          → mutated manifest, throws on missing
//   findEntry(manifest, name)            → Entry | undefined
//   resolveSiblingPath(repoRoot, entry)  → absolute path; rejects non-`../`
//   class DepsManifestShapeError         → NFR-10 canonical refusal shape
//
// Entry schema: { name: string, path: string, origin?: string, ref?: string,
//                  kind: "toolkit-docs" }.
//
// The tests are framework-agnostic w.r.t. the YAML implementation — only
// the behavior of the helpers is asserted.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import {
  addEntry,
  DepsManifestShapeError,
  findEntry,
  readManifest,
  removeEntry,
  resolveSiblingPath,
  writeManifest,
  type DepsEntry,
  type DepsManifest,
} from "../adapters/_shared/src/deps_manifest";

function makeSpecsDir(): { specsDir: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "deps-manifest-"));
  const specsDir = join(root, "specs");
  mkdirSync(specsDir, { recursive: true });
  return { specsDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function writeRawManifest(specsDir: string, body: string): void {
  writeFileSync(join(specsDir, "deps.yaml"), body);
}

// -----------------------------------------------------------------------------
// readManifest — missing / empty / malformed / valid
// -----------------------------------------------------------------------------

describe("AC-STE-301.2 — readManifest on missing file", () => {
  test("returns empty manifest (no throw)", () => {
    const { specsDir, cleanup } = makeSpecsDir();
    try {
      const m = readManifest(specsDir);
      expect(m.deps).toEqual([]);
    } finally {
      cleanup();
    }
  });
});

describe("AC-STE-301.2 — readManifest on empty manifest", () => {
  test("zero-entry manifest is valid", () => {
    const { specsDir, cleanup } = makeSpecsDir();
    try {
      writeRawManifest(specsDir, "deps: []\n");
      const m = readManifest(specsDir);
      expect(m.deps).toEqual([]);
    } finally {
      cleanup();
    }
  });
});

describe("AC-STE-301.1 — readManifest on malformed YAML", () => {
  test("throws DepsManifestShapeError", () => {
    const { specsDir, cleanup } = makeSpecsDir();
    try {
      writeRawManifest(specsDir, "deps: [unclosed\n  - bad");
      expect(() => readManifest(specsDir)).toThrow(DepsManifestShapeError);
    } finally {
      cleanup();
    }
  });
});

describe("AC-STE-301.1 — readManifest on valid manifest", () => {
  test("parses all entry fields", () => {
    const { specsDir, cleanup } = makeSpecsDir();
    try {
      writeRawManifest(
        specsDir,
        [
          "deps:",
          "  - name: my-sdk",
          "    path: ../my-sdk",
          "    origin: git@github.com:acme/my-sdk.git",
          "    ref: main",
          "    kind: toolkit-docs",
          "",
        ].join("\n"),
      );
      const m = readManifest(specsDir);
      expect(m.deps.length).toBe(1);
      const e = m.deps[0]!;
      expect(e.name).toBe("my-sdk");
      expect(e.path).toBe("../my-sdk");
      expect(e.origin).toBe("git@github.com:acme/my-sdk.git");
      expect(e.ref).toBe("main");
      expect(e.kind).toBe("toolkit-docs");
    } finally {
      cleanup();
    }
  });

  test("origin and ref are optional", () => {
    const { specsDir, cleanup } = makeSpecsDir();
    try {
      writeRawManifest(
        specsDir,
        [
          "deps:",
          "  - name: bare",
          "    path: ../bare",
          "    kind: toolkit-docs",
          "",
        ].join("\n"),
      );
      const m = readManifest(specsDir);
      expect(m.deps.length).toBe(1);
      expect(m.deps[0]!.name).toBe("bare");
      expect(m.deps[0]!.origin).toBeUndefined();
      expect(m.deps[0]!.ref).toBeUndefined();
    } finally {
      cleanup();
    }
  });
});

// -----------------------------------------------------------------------------
// Sibling-path-only constraint (path must start with `../`)
// -----------------------------------------------------------------------------

describe("AC-STE-301.2 — sibling-path-only constraint enforced at read time", () => {
  test("path that does not start with `../` ⇒ DepsManifestShapeError", () => {
    const { specsDir, cleanup } = makeSpecsDir();
    try {
      writeRawManifest(
        specsDir,
        [
          "deps:",
          "  - name: bad",
          "    path: /absolute/path",
          "    kind: toolkit-docs",
          "",
        ].join("\n"),
      );
      expect(() => readManifest(specsDir)).toThrow(DepsManifestShapeError);
    } finally {
      cleanup();
    }
  });

  test("nested sibling path `../foo/bar` is accepted (still starts with `../`)", () => {
    const { specsDir, cleanup } = makeSpecsDir();
    try {
      writeRawManifest(
        specsDir,
        [
          "deps:",
          "  - name: nested",
          "    path: ../foo/bar",
          "    kind: toolkit-docs",
          "",
        ].join("\n"),
      );
      const m = readManifest(specsDir);
      expect(m.deps[0]!.path).toBe("../foo/bar");
    } finally {
      cleanup();
    }
  });
});

// -----------------------------------------------------------------------------
// kind validation — toolkit-docs is the only supported value in M78.
// -----------------------------------------------------------------------------

describe("AC-STE-301.2 — entry validator rejects kind other than toolkit-docs", () => {
  test("kind: vendor-readme ⇒ DepsManifestShapeError", () => {
    const { specsDir, cleanup } = makeSpecsDir();
    try {
      writeRawManifest(
        specsDir,
        [
          "deps:",
          "  - name: bad-kind",
          "    path: ../bad-kind",
          "    kind: vendor-readme",
          "",
        ].join("\n"),
      );
      expect(() => readManifest(specsDir)).toThrow(DepsManifestShapeError);
    } finally {
      cleanup();
    }
  });
});

// -----------------------------------------------------------------------------
// addEntry / removeEntry / findEntry mutators
// -----------------------------------------------------------------------------

describe("AC-STE-301.1 — addEntry collision detection (NFR-10 canonical refusal)", () => {
  test("adding an entry whose name collides ⇒ DepsManifestShapeError", () => {
    const m: DepsManifest = {
      deps: [{ name: "sdk", path: "../sdk", kind: "toolkit-docs" }],
    };
    expect(() =>
      addEntry(m, { name: "sdk", path: "../other-sdk", kind: "toolkit-docs" }),
    ).toThrow(DepsManifestShapeError);
  });

  test("adding a unique entry appends to deps", () => {
    const m: DepsManifest = { deps: [] };
    const out = addEntry(m, {
      name: "fresh",
      path: "../fresh",
      kind: "toolkit-docs",
    });
    expect(out.deps.length).toBe(1);
    expect(out.deps[0]!.name).toBe("fresh");
  });

  test("addEntry rejects non-`../` path (sibling-only invariant)", () => {
    const m: DepsManifest = { deps: [] };
    expect(() =>
      addEntry(m, { name: "abs", path: "/abs/path", kind: "toolkit-docs" }),
    ).toThrow(DepsManifestShapeError);
  });

  test("addEntry rejects kind other than toolkit-docs", () => {
    const m: DepsManifest = { deps: [] };
    const bad: DepsEntry = {
      name: "x",
      path: "../x",
      kind: "vendor-readme" as unknown as "toolkit-docs",
    };
    expect(() => addEntry(m, bad)).toThrow(DepsManifestShapeError);
  });
});

describe("AC-STE-301.1 — removeEntry on missing name", () => {
  test("removing a name not in the manifest ⇒ DepsManifestShapeError", () => {
    const m: DepsManifest = {
      deps: [{ name: "sdk", path: "../sdk", kind: "toolkit-docs" }],
    };
    expect(() => removeEntry(m, "missing")).toThrow(DepsManifestShapeError);
  });

  test("removeEntry on present name removes it", () => {
    const m: DepsManifest = {
      deps: [
        { name: "sdk", path: "../sdk", kind: "toolkit-docs" },
        { name: "models", path: "../models", kind: "toolkit-docs" },
      ],
    };
    const out = removeEntry(m, "sdk");
    expect(out.deps.length).toBe(1);
    expect(out.deps[0]!.name).toBe("models");
  });
});

describe("AC-STE-301.1 — findEntry by name", () => {
  test("returns the matching entry", () => {
    const m: DepsManifest = {
      deps: [
        { name: "sdk", path: "../sdk", kind: "toolkit-docs" },
        { name: "models", path: "../models", kind: "toolkit-docs" },
      ],
    };
    const e = findEntry(m, "models");
    expect(e).toBeDefined();
    expect(e!.name).toBe("models");
  });

  test("returns undefined for missing name (does NOT throw)", () => {
    const m: DepsManifest = { deps: [] };
    expect(findEntry(m, "ghost")).toBeUndefined();
  });
});

// -----------------------------------------------------------------------------
// writeManifest round-trip
// -----------------------------------------------------------------------------

describe("AC-STE-301.1 — writeManifest round-trip via readManifest", () => {
  test("write then read returns the same entries", () => {
    const { specsDir, cleanup } = makeSpecsDir();
    try {
      const m: DepsManifest = {
        deps: [
          {
            name: "sdk",
            path: "../sdk",
            origin: "git@github.com:acme/sdk.git",
            ref: "main",
            kind: "toolkit-docs",
          },
          { name: "models", path: "../models", kind: "toolkit-docs" },
        ],
      };
      writeManifest(specsDir, m);
      const round = readManifest(specsDir);
      expect(round.deps.length).toBe(2);
      expect(round.deps[0]!.name).toBe("sdk");
      expect(round.deps[0]!.origin).toBe("git@github.com:acme/sdk.git");
      expect(round.deps[0]!.ref).toBe("main");
      expect(round.deps[1]!.name).toBe("models");
      expect(round.deps[1]!.origin).toBeUndefined();
    } finally {
      cleanup();
    }
  });
});

// -----------------------------------------------------------------------------
// resolveSiblingPath
// -----------------------------------------------------------------------------

describe("AC-STE-301.1 — resolveSiblingPath", () => {
  test("returns an absolute path that resolves against the consumer repo root", () => {
    const repoRoot = "/Users/test/workspace/consumer-app";
    const entry: DepsEntry = {
      name: "sdk",
      path: "../my-sdk",
      kind: "toolkit-docs",
    };
    const resolved = resolveSiblingPath(repoRoot, entry);
    expect(isAbsolute(resolved)).toBe(true);
    expect(resolved).toBe("/Users/test/workspace/my-sdk");
  });

  test("rejects non-`../` paths with DepsManifestShapeError", () => {
    const repoRoot = "/Users/test/workspace/consumer-app";
    const entry: DepsEntry = {
      name: "sdk",
      path: "/absolute/elsewhere",
      kind: "toolkit-docs",
    };
    expect(() => resolveSiblingPath(repoRoot, entry)).toThrow(
      DepsManifestShapeError,
    );
  });

  test("rejects bare basename (`my-sdk`, no `../` prefix)", () => {
    const repoRoot = "/Users/test/workspace/consumer-app";
    const entry: DepsEntry = {
      name: "sdk",
      path: "my-sdk",
      kind: "toolkit-docs",
    };
    expect(() => resolveSiblingPath(repoRoot, entry)).toThrow(
      DepsManifestShapeError,
    );
  });
});

// -----------------------------------------------------------------------------
// DepsManifestShapeError shape — NFR-10 canonical refusal
// -----------------------------------------------------------------------------

describe("AC-STE-301.1 — DepsManifestShapeError NFR-10 canonical shape", () => {
  test("error is an instance of Error and exposes a message", () => {
    const err = new DepsManifestShapeError("missing required field `name`");
    expect(err).toBeInstanceOf(Error);
    expect(err.message.length).toBeGreaterThan(0);
    expect(err.message).toContain("name");
  });

  test("error.name is `DepsManifestShapeError` (canonical class name)", () => {
    const err = new DepsManifestShapeError("test");
    expect(err.name).toBe("DepsManifestShapeError");
  });
});
