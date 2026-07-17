// M108 STE-391 AC-STE-391.1 — the version-ordered consumer-artifact migration
// registry: entry shape, load-time invariants, detector purity, and the
// single-source rule for retired path literals.
//
// Contract pinned by this file (FR § Technical Design, specs/frs/STE-391.md):
//
//   adapters/_shared/src/migrations/index.ts exports
//     - interface MigrationEntry {
//         id: string;                    // unique across the registry
//         introduced_in: string;         // semver of the release that made the
//                                        // legacy state legacy
//         title: string;
//         kind: "script" | "assisted";
//         requires_explicit_approval?: boolean;   // AC.6 rail
//         detect(projectRoot: string): { applies: boolean; evidence: string[] };
//         apply?(projectRoot: string): { changed: string[]; summary: string };
//       }
//     - MIGRATIONS: MigrationEntry[]     // version-ordered
//     - validateRegistry(entries): void  // throws on duplicate ids and on
//                                        // non-ascending introduced_in; the
//                                        // module calls it at load time
//
//   adapters/_shared/src/migrations/legacy_paths.ts — the ONLY non-test module
//   composing retired path literals (the retired-path twin of dpt_paths.ts).

import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MIGRATIONS, validateRegistry, type MigrationEntry } from "./index";

const MIGRATIONS_DIR = import.meta.dir;
const INDEX_SRC = join(MIGRATIONS_DIR, "index.ts");
const LEGACY_PATHS_SRC = join(MIGRATIONS_DIR, "legacy_paths.ts");

const SEMVER_RE = /^v?\d+\.\d+\.\d+$/;

function semverTuple(v: string): [number, number, number] {
  const m = v.replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)$/);
  expect(m).not.toBeNull();
  return [Number(m![1]), Number(m![2]), Number(m![3])];
}

function semverLte(a: string, b: string): boolean {
  const [a1, a2, a3] = semverTuple(a);
  const [b1, b2, b3] = semverTuple(b);
  if (a1 !== b1) return a1 < b1;
  if (a2 !== b2) return a2 < b2;
  return a3 <= b3;
}

/** Minimal well-formed entry for feeding validateRegistry bad lists. */
function fakeEntry(id: string, introduced_in: string): MigrationEntry {
  return {
    id,
    introduced_in,
    title: `fake ${id}`,
    kind: "script",
    detect: () => ({ applies: false, evidence: [] }),
    apply: () => ({ changed: [], summary: "" }),
  };
}

// ---------------------------------------------------------------------------
// AC-STE-391.1 — registry shape
// ---------------------------------------------------------------------------

describe("AC-STE-391.1 — MIGRATIONS entry shape", () => {
  test("the registry ships at least the four seeded script entries", () => {
    expect(MIGRATIONS.filter((e) => e.kind === "script").length).toBeGreaterThanOrEqual(4);
  });

  test("every entry carries id / introduced_in / title / kind / detect", () => {
    for (const e of MIGRATIONS) {
      expect(typeof e.id).toBe("string");
      expect(e.id.length).toBeGreaterThan(0);
      expect(e.introduced_in).toMatch(SEMVER_RE);
      expect(typeof e.title).toBe("string");
      expect(e.title.length).toBeGreaterThan(0);
      expect(["script", "assisted"]).toContain(e.kind);
      expect(typeof e.detect).toBe("function");
    }
  });

  test("script entries carry apply; assisted entries carry NO apply (FR § Technical Design)", () => {
    for (const e of MIGRATIONS) {
      if (e.kind === "script") {
        expect(typeof e.apply).toBe("function");
      } else {
        expect(e.apply).toBeUndefined();
      }
    }
  });

  test("ids are unique", () => {
    const ids = MIGRATIONS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("the list is version-ordered by introduced_in (ascending)", () => {
    for (let i = 1; i < MIGRATIONS.length; i++) {
      const prev = MIGRATIONS[i - 1]!;
      const next = MIGRATIONS[i]!;
      expect(semverLte(prev.introduced_in, next.introduced_in)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-391.1 — load-time invariants
// ---------------------------------------------------------------------------

describe("AC-STE-391.1 — registry invariants (dup-id, version ordering)", () => {
  test("validateRegistry passes on a well-formed ascending list", () => {
    expect(() =>
      validateRegistry([fakeEntry("a", "1.0.0"), fakeEntry("b", "1.2.0"), fakeEntry("c", "2.0.0")]),
    ).not.toThrow();
  });

  test("duplicate ids are rejected", () => {
    expect(() => validateRegistry([fakeEntry("dup", "1.0.0"), fakeEntry("dup", "1.1.0")])).toThrow(
      /duplicate/i,
    );
  });

  test("non-ascending introduced_in ordering is rejected", () => {
    expect(() => validateRegistry([fakeEntry("a", "2.0.0"), fakeEntry("b", "1.0.0")])).toThrow(
      /ascend|order|version/i,
    );
  });

  test("the shipped MIGRATIONS list satisfies its own invariants", () => {
    expect(() => validateRegistry(MIGRATIONS)).not.toThrow();
  });

  test("index.ts runs the invariants at module load, not only on demand", () => {
    // AC.1: "the registry rejects duplicate ids and non-ascending introduced_in
    // ordering AT MODULE LOAD". The importable proof is the call site itself.
    const src = readFileSync(INDEX_SRC, "utf-8");
    expect(src).toMatch(/validateRegistry\(\s*MIGRATIONS\s*\)/);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-391.1 — detector purity and determinism
// ---------------------------------------------------------------------------

describe("AC-STE-391.1 — detect() is a pure, synchronous, deterministic predicate", () => {
  test("on an empty tree every detector returns {applies: false} and creates nothing", () => {
    const root = mkdtempSync(join(tmpdir(), "ste-391-registry-"));
    try {
      for (const e of MIGRATIONS) {
        const res = e.detect(root);
        // Synchronous: a Promise here would mean the runner's walk needs await
        // plumbing the FR explicitly rules out.
        expect(typeof (res as unknown as { then?: unknown }).then).not.toBe("function");
        expect(res.applies).toBe(false);
        expect(Array.isArray(res.evidence)).toBe(true);
      }
      // Purity: the walk over a pristine tree left it pristine.
      expect(readdirSync(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("detect is deterministic — two runs over the same tree agree", () => {
    const root = mkdtempSync(join(tmpdir(), "ste-391-registry-"));
    try {
      for (const e of MIGRATIONS) {
        expect(e.detect(root)).toEqual(e.detect(root));
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-391.1 — legacy_paths.ts is the single source of retired literals
// ---------------------------------------------------------------------------

describe("AC-STE-391.1 — retired path literals live in ONE module", () => {
  test("migrations/legacy_paths.ts exists", () => {
    expect(existsSync(LEGACY_PATHS_SRC)).toBe(true);
  });

  test("legacy_paths.ts actually carries the retired literals it exists for", () => {
    const src = readFileSync(LEGACY_PATHS_SRC, "utf-8");
    // The FR's § Technical Design names the literal families: locks dir,
    // ledger dir, v1 marker/index filenames, sync-log heading, stale
    // hook-entry shapes.
    expect(src).toContain(".dpt-locks");
    expect(src).toContain(".dev-process");
    expect(src).toContain(".dpt-layout");
    expect(src).toContain("INDEX.md");
    expect(src).toContain("Sync log");
    expect(src).toContain("templates/hooks/process");
  });

  test("no OTHER non-test file in the migrations module composes a retired literal", () => {
    const banned = [
      /\.dpt-locks/,
      /\.dev-process/,
      /\.dpt-layout/,
      /INDEX\.md/,
      /Sync log/,
      /templates\/hooks\/process/,
    ];
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!full.endsWith(".ts")) continue;
        if (full.endsWith(".test.ts")) continue; // decoy carve-out, STE-384 shape
        if (full === LEGACY_PATHS_SRC) continue; // the single source itself
        const src = readFileSync(full, "utf-8");
        for (const re of banned) {
          if (re.test(src)) offenders.push(`${full} composes ${re.source}`);
        }
      }
    };
    walk(MIGRATIONS_DIR);
    expect(offenders).toEqual([]);
  });
});
