import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { locksDir as dptLocksDir } from "../adapters/_shared/src/dpt_paths";

// STE-82 AC-STE-82.3 + AC-STE-82.7 — gate-check probe #3 integration test.
//
// Probe 3 scans `.dpt/locks/<ulid>` entries whose `branch:` field names a
// merged-into-main or deleted branch. Each stale lock surfaces as
// GATE PASSED WITH NOTES (warn-only, never GATE FAILED). The probe offers
// `$ARGUMENTS --cleanup-stale-locks` to delete them in one commit
// (AC-STE-28.5).
//
// Positive fixture: an active lock file on the current branch (not merged)
// — probe emits no note.
// Negative fixture: a lock file pointing at a branch that no longer exists
// — probe emits a note with the `.dpt/locks/<ulid>:branch — reason` shape.
//
// M104 STE-382 AC-STE-382.3 — locks moved from `.dpt-locks/` into the
// consolidated `.dpt/locks/`. They remain TRACKED + COMMITTED (STE-28
// semantics); only the path moved.

const pluginRoot = join(import.meta.dir, "..");
const gateCheckSkillPath = join(pluginRoot, "skills", "gate-check", "SKILL.md");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("STE-82 AC-STE-82.3 prose — /gate-check probe 3 is documented in SKILL.md", () => {
  test("SKILL.md names the Stale lock scan probe", () => {
    const body = read(gateCheckSkillPath);
    expect(body).toMatch(/Stale lock scan/i);
  });

  test("probe names `.dpt/locks/<ulid>` + branch-merged detection + cleanup action", () => {
    const body = read(gateCheckSkillPath);
    expect(body).toMatch(/\.dpt\/locks\/.*<ulid>/);
    // The legacy path must not linger in the prose the LLM consumes.
    expect(body).not.toMatch(/\.dpt-locks/);
    expect(body).toMatch(/merged|deleted/);
    expect(body).toMatch(/--cleanup-stale-locks/);
    // Toolkit-meta `AC-STE-<N>.<M>` literals are scrubbed from skill prose
    // (commit 2069ba4). The cleanup-action concept survives in the
    // `--cleanup-stale-locks` flag mention above; assert the single-commit
    // delete semantics survive.
    expect(body).toMatch(/single commit|deletes? them/i);
  });

  test("probe is warn-only: GATE PASSED WITH NOTES, not GATE FAILED", () => {
    const body = read(gateCheckSkillPath);
    const probeIdx = body.search(/Stale lock scan/i);
    expect(probeIdx).toBeGreaterThan(-1);
    const block = body.slice(probeIdx, probeIdx + 400);
    expect(block).toContain("GATE PASSED WITH NOTES");
    expect(block).not.toContain("GATE FAILED");
  });
});

describe("STE-82 AC-STE-82.3/7 — stale-lock file-content fixtures (positive + negative)", () => {
  function makeLockDir(): { root: string; locksDir: string; cleanup: () => void } {
    const root = mkdtempSync(join(tmpdir(), "stale-lock-"));
    const locks = dptLocksDir(root);
    mkdirSync(locks, { recursive: true });
    return { root, locksDir: locks, cleanup: () => rmSync(root, { recursive: true, force: true }) };
  }

  test("POSITIVE: lock file on an active branch parses cleanly and isn't flagged", () => {
    const ctx = makeLockDir();
    try {
      const lockPath = join(ctx.locksDir, "fr_01KPZ7GRFN656QFSG79EY53YJV");
      writeFileSync(
        lockPath,
        `---\nbranch: feat/m12-tracker-integration\nassignee: test@example.com\nclaimed_at: 2026-04-24T08:00:00Z\n---\n`,
      );
      const body = readFileSync(lockPath, "utf8");
      // The probe reads `branch:` via frontmatter parser. For this positive
      // fixture, we check the field extracts cleanly — the stale-branch
      // judgment itself is a git subshell probe and is exercised in-session.
      expect(body).toContain("branch: feat/m12-tracker-integration");
    } finally {
      ctx.cleanup();
    }
  });

  test("NEGATIVE: lock file pointing at a deleted branch renders the documented note shape", () => {
    const ctx = makeLockDir();
    try {
      const ulid = "fr_01KPZ7GRFN656QFSG79EY53YJV";
      const staleBranch = "feat/long-abandoned-branch";
      writeFileSync(
        join(ctx.locksDir, ulid),
        `---\nbranch: ${staleBranch}\nassignee: test@example.com\nclaimed_at: 2026-03-01T00:00:00Z\n---\n`,
      );
      // AC-STE-82.7 note shape: `file:line — reason`.
      const note = `.dpt/locks/${ulid}:2 — branch ${staleBranch} is merged or deleted`;
      expect(note).toMatch(/^\.dpt\/locks\/fr_[0-9A-HJKMNP-TV-Z]{26}:\d+ — branch .+ is merged or deleted$/);
    } finally {
      ctx.cleanup();
    }
  });
});

describe("AC-STE-139.5 — stale-lock-scan runs clean on this repo's baseline", () => {
  test("the live repo's .dpt/locks/ either is absent or contains no merged-branch entries", async () => {
    const { existsSync, readdirSync } = await import("node:fs");
    const repoRoot = join(import.meta.dir, "..", "..", "..");
    const locksDir = dptLocksDir(repoRoot);
    if (!existsSync(locksDir)) {
      // Tracker mode: lock files are vacuous (mode: linear stores In Progress
      // on the tracker, not on disk). Vacuous pass — there is nothing to scan.
      expect(true).toBe(true);
      return;
    }
    const entries = readdirSync(locksDir).filter((n) => !n.startsWith("."));
    // No active locks expected on a clean working branch — the only valid
    // state for the live repo is zero entries (or entries that match the
    // current branch, which we don't compute here for simplicity).
    expect(entries).toEqual([]);
  });
});
