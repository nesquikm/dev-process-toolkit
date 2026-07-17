// M108 STE-391 AC-STE-391.3 — seed entry: M104 legacy state.
//
// Detector fires on ANY of: legacy locks dir present, legacy ledger dir
// present, stale ledger line in the consumer's root .gitignore. Apply:
// `git rm -r` the tracked locks dir, delete the ledger dir, strip the stale
// root-.gitignore line, ensure `.dpt/` + nested `.gitignore` via the existing
// writeDptGitignore. Delete-everything semantics — no data migration.
//
// Fixture discipline (FR § Testing): per-state fixture trees via mkdtempSync,
// REAL git init/commit where tracked-file moves are asserted (STE-383 AC.5
// precedent). The retired literals composed below are deliberate — this is a
// `.test.ts` decoy under the STE-384 carve-out.

import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DPT_GITIGNORE_BODY } from "../adapters/_shared/src/setup/dpt_gitignore";
import { MIGRATIONS, type MigrationEntry } from "../adapters/_shared/src/migrations/index";

const LEGACY_LOCKS_DIR = ".dpt-locks";
const LEGACY_LEDGER_DIR = ".dev-process";
const STALE_IGNORE_LINE = ".dev-process/";

const tmpRoots: string[] = [];

function makeTree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "ste-391-m104-"));
  tmpRoots.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, ...rel.split("/"));
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}

function cleanup(): void {
  while (tmpRoots.length > 0) {
    const dir = tmpRoots.pop()!;
    if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
}

function git(cwd: string, args: string[]): { exitCode: number; stdout: string } {
  const proc = Bun.spawnSync(
    ["git", "-c", "user.email=t@t.test", "-c", "user.name=t", ...args],
    { cwd, stdout: "pipe", stderr: "pipe" },
  );
  return { exitCode: proc.exitCode, stdout: proc.stdout.toString() };
}

/** git init + add -A + commit, so tracked-file assertions are real. */
function gitify(root: string): void {
  expect(git(root, ["init", "-q"]).exitCode).toBe(0);
  expect(git(root, ["add", "-A"]).exitCode).toBe(0);
  expect(git(root, ["commit", "-q", "-m", "init"]).exitCode).toBe(0);
}

/** The full M104-legacy consumer: tracked locks, ignored ledger, stale line. */
function makeFullLegacyRepo(): string {
  const root = makeTree({
    ".gitignore": `node_modules/\n${STALE_IGNORE_LINE}\n.env\n`,
    [`${LEGACY_LOCKS_DIR}/M7.md`]: "milestone: M7\n",
    "src/app.ts": "export const app = 1;\n",
  });
  gitify(root);
  // Ledger written AFTER the commit — it is ignored by the stale line, exactly
  // like a real pre-M104 consumer tree.
  mkdirSync(join(root, LEGACY_LEDGER_DIR), { recursive: true });
  writeFileSync(join(root, LEGACY_LEDGER_DIR, "token-ledger.jsonl"), '{"schema":"token-ledger/v1"}\n');
  return root;
}

function detecting(root: string): MigrationEntry[] {
  return MIGRATIONS.filter((e) => e.detect(root).applies);
}

/** Exactly one registry entry detects this fixture; return it. */
function soleDetectingEntry(root: string): MigrationEntry {
  const hits = detecting(root);
  expect(hits.map((e) => e.id).length).toBe(1);
  return hits[0]!;
}

// ---------------------------------------------------------------------------
// detection
// ---------------------------------------------------------------------------

describe("AC-STE-391.3 — detector fires on any of the three legacy signals", () => {
  test("full legacy fixture: exactly ONE registry entry detects, kind script, batch-approvable", () => {
    const root = makeFullLegacyRepo();
    const entry = soleDetectingEntry(root);
    expect(entry.kind).toBe("script");
    expect(typeof entry.apply).toBe("function");
    // AC.3 applies under the ONE-approval-commit batch (AC.2); the explicit
    // per-entry approval rail belongs to the permission-shapes entry alone.
    expect(entry.requires_explicit_approval).toBeFalsy();
    const res = entry.detect(root);
    expect(res.applies).toBe(true);
    expect(res.evidence.length).toBeGreaterThan(0);
    expect(res.evidence.join("\n")).toContain(LEGACY_LOCKS_DIR);
    cleanup();
  });

  test("locks dir ALONE fires", () => {
    const root = makeTree({
      [`${LEGACY_LOCKS_DIR}/M7.md`]: "milestone: M7\n",
      "src/app.ts": "export const app = 1;\n",
    });
    gitify(root);
    expect(soleDetectingEntry(root).detect(root).applies).toBe(true);
    cleanup();
  });

  test("ledger dir ALONE fires", () => {
    const root = makeTree({
      [`${LEGACY_LEDGER_DIR}/token-ledger.jsonl`]: '{"schema":"token-ledger/v1"}\n',
      "src/app.ts": "export const app = 1;\n",
    });
    gitify(root);
    expect(soleDetectingEntry(root).detect(root).applies).toBe(true);
    cleanup();
  });

  test("stale root-.gitignore ledger line ALONE fires", () => {
    const root = makeTree({
      ".gitignore": `node_modules/\n${STALE_IGNORE_LINE}\n`,
      "src/app.ts": "export const app = 1;\n",
    });
    gitify(root);
    expect(soleDetectingEntry(root).detect(root).applies).toBe(true);
    cleanup();
  });

  test("a clean post-M104 consumer detects NOTHING across the whole registry", () => {
    const root = makeTree({
      ".gitignore": "node_modules/\n.env\n",
      ".dpt/.gitignore": DPT_GITIGNORE_BODY,
      "src/app.ts": "export const app = 1;\n",
    });
    gitify(root);
    expect(detecting(root).map((e) => e.id)).toEqual([]);
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// detector purity
// ---------------------------------------------------------------------------

describe("AC-STE-391.3 — detect() leaves the fixture untouched", () => {
  test("content and mtime of every fixture file survive the detection walk", () => {
    const root = makeFullLegacyRepo();
    const watched = [
      join(root, ".gitignore"),
      join(root, LEGACY_LOCKS_DIR, "M7.md"),
      join(root, LEGACY_LEDGER_DIR, "token-ledger.jsonl"),
    ];
    const before = watched.map((f) => ({
      content: readFileSync(f, "utf-8"),
      mtimeMs: statSync(f).mtimeMs,
    }));

    for (const e of MIGRATIONS) e.detect(root);

    watched.forEach((f, i) => {
      expect(readFileSync(f, "utf-8")).toBe(before[i]!.content);
      expect(statSync(f).mtimeMs).toBe(before[i]!.mtimeMs);
    });
    // detect must not pre-create the replacement tree either.
    expect(existsSync(join(root, ".dpt"))).toBe(false);
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// apply
// ---------------------------------------------------------------------------

describe("AC-STE-391.3 — apply: delete-everything semantics", () => {
  test("full legacy fixture: locks git-rm'd, ledger deleted, stale line stripped, .dpt ensured", () => {
    const root = makeFullLegacyRepo();
    const entry = soleDetectingEntry(root);

    const result = entry.apply!(root);
    expect(Array.isArray(result.changed)).toBe(true);
    expect(result.changed.length).toBeGreaterThan(0);
    for (const path of result.changed) expect(typeof path).toBe("string");
    expect(typeof result.summary).toBe("string");
    expect(result.summary.length).toBeGreaterThan(0);

    // Locks: gone from the working tree AND from the git index (`git rm -r`,
    // not a bare rmSync that would leave the deletion unstaged/undetected).
    expect(existsSync(join(root, LEGACY_LOCKS_DIR))).toBe(false);
    expect(git(root, ["ls-files", "--", LEGACY_LOCKS_DIR]).stdout.trim()).toBe("");

    // Ledger: deleted, no data migration.
    expect(existsSync(join(root, LEGACY_LEDGER_DIR))).toBe(false);

    // Stale line stripped; the user's other rules survive byte-for-byte.
    expect(readFileSync(join(root, ".gitignore"), "utf-8")).toBe("node_modules/\n.env\n");

    // `.dpt/` + nested ignore ensured via the existing writeDptGitignore body.
    expect(readFileSync(join(root, ".dpt", ".gitignore"), "utf-8")).toBe(DPT_GITIGNORE_BODY);

    // Unrelated tracked content untouched.
    expect(readFileSync(join(root, "src", "app.ts"), "utf-8")).toBe("export const app = 1;\n");
    expect(git(root, ["ls-files", "--", "src/app.ts"]).stdout.trim()).toBe("src/app.ts");
    cleanup();
  });

  test("an UNTRACKED locks dir is still removed — delete-everything, not git-only", () => {
    const root = makeTree({
      ".gitignore": "node_modules/\n",
      "src/app.ts": "export const app = 1;\n",
    });
    gitify(root);
    // Created after the commit: present on disk, unknown to the index.
    mkdirSync(join(root, LEGACY_LOCKS_DIR), { recursive: true });
    writeFileSync(join(root, LEGACY_LOCKS_DIR, "M9.md"), "milestone: M9\n");

    const entry = soleDetectingEntry(root);
    entry.apply!(root);
    expect(existsSync(join(root, LEGACY_LOCKS_DIR))).toBe(false);
    cleanup();
  });

  test("apply → detect=false; re-apply is a no-op", () => {
    const root = makeFullLegacyRepo();
    const entry = soleDetectingEntry(root);

    entry.apply!(root);
    expect(entry.detect(root).applies).toBe(false);

    const gitignoreBefore = readFileSync(join(root, ".gitignore"), "utf-8");
    const listingBefore = readdirSync(root).sort();
    const second = entry.apply!(root);
    expect(second.changed).toEqual([]);
    expect(readFileSync(join(root, ".gitignore"), "utf-8")).toBe(gitignoreBefore);
    expect(readdirSync(root).sort()).toEqual(listingBefore);
    cleanup();
  });
});
