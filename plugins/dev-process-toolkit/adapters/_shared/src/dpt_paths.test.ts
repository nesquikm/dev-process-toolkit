// STE-382 AC-STE-382.1 + AC-STE-382.7 — `.dpt` path single-source-of-truth.
//
// AC-STE-382.1 — `dpt_paths.ts` is the sole composer of `.dpt` path
//   literals: `dptRoot` / `locksDir` / `ledgerPath` / `scratchDir`. Pure
//   path composition, no I/O.
// AC-STE-382.7 — the EISDIR collision is dissolved BY LAYOUT: locks and
//   scratch are disjoint sibling subtrees, so `findStaleLocks`' guard-free
//   readdir+readFileSync can never meet a research-scratch directory. The
//   structural half of that proof lives here; the behavioral half lives in
//   `local_provider.test.ts`.

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { dptRoot, ledgerPath, locksDir, scratchDir } from "./dpt_paths";

const ROOT = join(sep, "tmp", "example-project");
const ULID = "01HZZZQK5T0000000000000001";

// -----------------------------------------------------------------------------
// AC-STE-382.1 — the four exported composers
// -----------------------------------------------------------------------------

describe("AC-STE-382.1 — dpt_paths composes the canonical `.dpt` tree", () => {
  test("dptRoot(projectRoot) → <root>/.dpt", () => {
    expect(dptRoot(ROOT)).toBe(join(ROOT, ".dpt"));
  });

  test("locksDir(projectRoot) → <root>/.dpt/locks", () => {
    expect(locksDir(ROOT)).toBe(join(ROOT, ".dpt", "locks"));
  });

  test("ledgerPath(projectRoot) → <root>/.dpt/ledger/token-ledger.jsonl", () => {
    expect(ledgerPath(ROOT)).toBe(
      join(ROOT, ".dpt", "ledger", "token-ledger.jsonl"),
    );
  });

  test("scratchDir(projectRoot, ulid) → <root>/.dpt/scratch/<ulid>", () => {
    expect(scratchDir(ROOT, ULID)).toBe(join(ROOT, ".dpt", "scratch", ULID));
  });

  test("every composed path is nested under dptRoot(projectRoot)", () => {
    const root = dptRoot(ROOT);
    for (const p of [locksDir(ROOT), ledgerPath(ROOT), scratchDir(ROOT, ULID)]) {
      const rel = relative(root, p);
      expect(rel.startsWith("..")).toBe(false);
      expect(rel).not.toBe("");
    }
  });

  test("scratchDir keeps distinct ULIDs in distinct sibling directories", () => {
    const a = scratchDir(ROOT, "01HAAA0000000000000000000A");
    const b = scratchDir(ROOT, "01HBBB0000000000000000000B");
    expect(a).toBe(join(ROOT, ".dpt", "scratch", "01HAAA0000000000000000000A"));
    expect(b).toBe(join(ROOT, ".dpt", "scratch", "01HBBB0000000000000000000B"));
    expect(a).not.toBe(b);
  });
});

// -----------------------------------------------------------------------------
// AC-STE-382.1 — "pure path composition, no I/O"
// -----------------------------------------------------------------------------

describe("AC-STE-382.1 — composition is pure: no filesystem side effects", () => {
  test("composing paths for a non-existent root creates nothing on disk", () => {
    const root = join(tmpdir(), `dpt-paths-never-created-${process.pid}-${Date.now()}`);
    expect(existsSync(root)).toBe(false);

    // Compose every path the module offers against a root that does not exist.
    expect(locksDir(root)).toBe(join(root, ".dpt", "locks"));
    expect(ledgerPath(root)).toBe(join(root, ".dpt", "ledger", "token-ledger.jsonl"));
    expect(scratchDir(root, ULID)).toBe(join(root, ".dpt", "scratch", ULID));

    // A composer that mkdir'd (or otherwise touched disk) would fail here.
    expect(existsSync(root)).toBe(false);
    expect(existsSync(join(root, ".dpt"))).toBe(false);
  });

  test("composers are deterministic — same input, byte-equal output", () => {
    expect(locksDir(ROOT)).toBe(locksDir(ROOT));
    expect(ledgerPath(ROOT)).toBe(ledgerPath(ROOT));
    expect(scratchDir(ROOT, ULID)).toBe(scratchDir(ROOT, ULID));
  });
});

// -----------------------------------------------------------------------------
// AC-STE-382.7 — locks ∩ scratch = ∅ (the layout IS the fix)
// -----------------------------------------------------------------------------

describe("AC-STE-382.7 — locks and scratch are disjoint subtrees", () => {
  test("scratchDir is NOT nested under locksDir", () => {
    // Pre-M104 the research scratch lived at `.dpt-locks/<ulid>/...`, making
    // `<ulid>` a directory inside the very folder whose entries findStaleLocks
    // readFileSync's without an isDirectory guard → EISDIR. The new layout
    // makes that shape unrepresentable.
    const rel = relative(locksDir(ROOT), scratchDir(ROOT, ULID));
    expect(rel.startsWith("..")).toBe(true);
  });

  test("locksDir is NOT nested under the scratch tree", () => {
    const rel = relative(join(dptRoot(ROOT), "scratch"), locksDir(ROOT));
    expect(rel.startsWith("..")).toBe(true);
  });

  test("the ledger is disjoint from both locks and scratch", () => {
    expect(relative(locksDir(ROOT), ledgerPath(ROOT)).startsWith("..")).toBe(true);
    expect(
      relative(join(dptRoot(ROOT), "scratch"), ledgerPath(ROOT)).startsWith(".."),
    ).toBe(true);
  });

  test("locks / ledger / scratch are siblings directly under .dpt", () => {
    const root = dptRoot(ROOT);
    expect(relative(root, locksDir(ROOT))).toBe("locks");
    expect(relative(root, scratchDir(ROOT, ULID))).toBe(join("scratch", ULID));
    expect(relative(root, ledgerPath(ROOT))).toBe(
      join("ledger", "token-ledger.jsonl"),
    );
  });
});
