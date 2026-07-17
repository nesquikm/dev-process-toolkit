// M108 STE-392 AC-STE-392.2 + AC-STE-392.5 — the two mutating rails of the
// assisted monolith-split flow: the mandatory backup, and the freeze.
//
// Contract pinned by this file (FR § Testing rows "Backup rail" / "Freeze
// step" — these are fixture rows, not prose greps, so they need real
// functions). Derived from the AC text:
//
//   adapters/_shared/src/migrations/monolith_split.ts exports
//     - backupSpecsTree(projectRoot): { path, files }
//         Copies the FULL specs/ tree to a timestamped sibling dir at the
//         project root (`specs-backup-<ISO-ts>/`, collision-suffixed).
//         Throws in NFR-10 shape on copy failure, pre-mutation.
//     - freezeMonolith(projectRoot, openMilestones): { legacy, requirements, planStubs }
//         Relocates the monolithic requirements+plan into the specs archive
//         byte-for-byte (git mv when tracked, fs move otherwise), scaffolds a
//         fresh cross-cutting requirements.md from the shipped template with a
//         pointer line to the archive, and stubs specs/plan/M<N>.md for the
//         open-work milestones ONLY.
//
// Path returns may be absolute or project-relative — the AC does not say — so
// this file normalizes them and keeps every behavioral assertion strict.

import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { backupSpecsTree, freezeMonolith } from "../adapters/_shared/src/migrations/monolith_split";

const isRoot = process.getuid?.() === 0;

const MONOLITH_REQUIREMENTS = [
  "# Requirements",
  "",
  "## 2. Functional Requirements",
  "",
  "### FR-8: Widget search {#FR-8}",
  "",
  "- AC-8.1: Query returns matches ranked by score.",
  "",
  "### FR-12: Widget import {#FR-12}",
  "",
  "- AC-12.1: CSV rows become widgets.",
  "- AC-12.2: Malformed rows are rejected with a message.",
  "- AC-12.3: Import is idempotent.",
  "",
  "### FR-31: Monthly rollup {#FR-31}",
  "",
  "- AC-31.1: Rollup renders every SKU sold in the month.",
  "",
].join("\n");

const MONOLITH_PLAN = [
  "# Plan",
  "",
  "## M1: Search foundation",
  "",
  "- [x] AC-8.1 — Query returns matches ranked by score",
  "",
  "## M2: Import pipeline",
  "",
  "- [x] AC-12.1 — CSV rows become widgets",
  "- [ ] AC-12.2 — Malformed rows are rejected with a message",
  "- [~] AC-12.3 — Import is idempotent",
  "",
  "## M3: Reporting",
  "",
  "- [ ] AC-31.1 — Rollup renders every SKU sold in the month",
  "",
].join("\n");

/** The monolithic pilot shape: nested files included, so "full tree" is real. */
const MONOLITH_TREE: Record<string, string> = {
  "specs/requirements.md": MONOLITH_REQUIREMENTS,
  "specs/plan.md": MONOLITH_PLAN,
  "specs/technical-spec.md": "# Technical Spec\n\nCross-cutting.\n",
  "specs/testing-spec.md": "# Testing Spec\n\nCross-cutting.\n",
  "specs/design/moodboard.md": "# Moodboard\n\nNested one level down.\n",
};

const roots: string[] = [];

function makeTree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "ste-392-flow-"));
  roots.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, ...rel.split("/"));
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}

function cleanup(): void {
  while (roots.length > 0) {
    const dir = roots.pop()!;
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
}

const abs = (root: string, p: string): string => (isAbsolute(p) ? p : join(root, p));
const read = (p: string): string => readFileSync(p, "utf-8");

/** Every file under `dir`, as project-relative POSIX paths. */
function listFiles(dir: string, prefix = ""): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix === "" ? e.name : `${prefix}/${e.name}`;
    if (e.isDirectory()) out.push(...listFiles(join(dir, e.name), rel));
    else out.push(rel);
  }
  return out.sort();
}

const git = (root: string, ...args: string[]): string =>
  new TextDecoder().decode(
    Bun.spawnSync({ cmd: ["git", ...args], cwd: root, stdout: "pipe", stderr: "pipe" }).stdout,
  );

// ---------------------------------------------------------------------------
// AC-STE-392.2 — the backup rail
// ---------------------------------------------------------------------------

describe("AC-STE-392.2 — backupSpecsTree copies the full specs/ tree", () => {
  test("the backup is a timestamped sibling directory at the project root", () => {
    const root = makeTree(MONOLITH_TREE);
    try {
      const { path } = backupSpecsTree(root);
      // Sibling of specs/, i.e. a direct child of the project root.
      expect(dirname(abs(root, path))).toBe(root);
      expect(basename(abs(root, path))).toMatch(/^specs-backup-/);
      // Timestamped: the name carries a date, not just a counter.
      expect(basename(abs(root, path))).toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(existsSync(abs(root, path))).toBe(true);
    } finally {
      cleanup();
    }
  });

  test("every file is copied byte-for-byte, nested paths included", () => {
    const root = makeTree(MONOLITH_TREE);
    try {
      const { path } = backupSpecsTree(root);
      const dest = abs(root, path);
      expect(read(join(dest, "requirements.md"))).toBe(MONOLITH_REQUIREMENTS);
      expect(read(join(dest, "plan.md"))).toBe(MONOLITH_PLAN);
      expect(read(join(dest, "technical-spec.md"))).toBe("# Technical Spec\n\nCross-cutting.\n");
      expect(read(join(dest, "design", "moodboard.md"))).toBe("# Moodboard\n\nNested one level down.\n");
    } finally {
      cleanup();
    }
  });

  test("the copy is complete — the backup mirrors the source file set exactly", () => {
    const root = makeTree(MONOLITH_TREE);
    try {
      const { path } = backupSpecsTree(root);
      expect(listFiles(abs(root, path))).toEqual(listFiles(join(root, "specs")));
    } finally {
      cleanup();
    }
  });

  test("the source specs/ tree is left untouched", () => {
    const root = makeTree(MONOLITH_TREE);
    try {
      const before = listFiles(join(root, "specs")).map((f) => [f, read(join(root, "specs", f))]);
      backupSpecsTree(root);
      const after = listFiles(join(root, "specs")).map((f) => [f, read(join(root, "specs", f))]);
      expect(after).toEqual(before);
    } finally {
      cleanup();
    }
  });

  test("`files` reports what was copied", () => {
    const root = makeTree(MONOLITH_TREE);
    try {
      const { files } = backupSpecsTree(root);
      expect(Array.isArray(files)).toBe(true);
      expect(files.length).toBe(listFiles(join(root, "specs")).length);
      expect(files.some((f) => f.includes("requirements.md"))).toBe(true);
      expect(files.some((f) => f.includes("moodboard.md"))).toBe(true);
    } finally {
      cleanup();
    }
  });

  test("collision-suffixed: two backups in the same run never overwrite each other", () => {
    const root = makeTree(MONOLITH_TREE);
    try {
      const first = backupSpecsTree(root);
      const second = backupSpecsTree(root);
      expect(abs(root, second.path)).not.toBe(abs(root, first.path));
      // Both survive intact — the second did not clobber the first.
      expect(read(join(abs(root, first.path), "requirements.md"))).toBe(MONOLITH_REQUIREMENTS);
      expect(read(join(abs(root, second.path), "requirements.md"))).toBe(MONOLITH_REQUIREMENTS);
    } finally {
      cleanup();
    }
  });
});

describe("AC-STE-392.2 — copy failure aborts PRE-mutation in NFR-10 shape", () => {
  test.skipIf(isRoot)("an unreadable file in specs/ makes the backup throw, not proceed", () => {
    const root = makeTree(MONOLITH_TREE);
    const poisoned = join(root, "specs", "technical-spec.md");
    try {
      chmodSync(poisoned, 0o000);
      expect(() => backupSpecsTree(root)).toThrow();
    } finally {
      chmodSync(poisoned, 0o644);
      cleanup();
    }
  });

  test.skipIf(isRoot)("the refusal carries the NFR-10 canonical shape", () => {
    const root = makeTree(MONOLITH_TREE);
    const poisoned = join(root, "specs", "technical-spec.md");
    try {
      chmodSync(poisoned, 0o000);
      let message = "";
      try {
        backupSpecsTree(root);
      } catch (e) {
        message = e instanceof Error ? e.message : String(e);
      }
      expect(message).toMatch(/Refusing/);
      expect(message).toMatch(/Remedy/);
      expect(message).toMatch(/Context/);
    } finally {
      chmodSync(poisoned, 0o644);
      cleanup();
    }
  });

  test.skipIf(isRoot)("PRE-mutation: the specs/ tree survives the failed backup intact", () => {
    // The whole point of the rail — a git-ignored specs tree has no other
    // safety net, so a backup that fails must leave the source untouched.
    const root = makeTree(MONOLITH_TREE);
    const poisoned = join(root, "specs", "technical-spec.md");
    try {
      chmodSync(poisoned, 0o000);
      try {
        backupSpecsTree(root);
      } catch {
        /* expected */
      }
      chmodSync(poisoned, 0o644);
      expect(read(join(root, "specs", "requirements.md"))).toBe(MONOLITH_REQUIREMENTS);
      expect(read(join(root, "specs", "plan.md"))).toBe(MONOLITH_PLAN);
      expect(listFiles(join(root, "specs"))).toEqual(Object.keys(MONOLITH_TREE).map((k) =>
        k.replace(/^specs\//, ""),
      ).sort());
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-392.5 — the freeze step
// ---------------------------------------------------------------------------

describe("AC-STE-392.5 — the monolith relocates to the specs archive byte-for-byte", () => {
  test("legacy requirements + plan land under a specs/ archive path", () => {
    const root = makeTree(MONOLITH_TREE);
    try {
      const { legacy } = freezeMonolith(root, ["M2", "M3"]);
      expect(legacy.length).toBeGreaterThanOrEqual(2);
      for (const p of legacy) {
        const rel = relative(root, abs(root, p));
        expect(rel.startsWith("specs")).toBe(true);
        expect(rel).toMatch(/archive/);
        expect(existsSync(abs(root, p))).toBe(true);
      }
    } finally {
      cleanup();
    }
  });

  test("content is preserved byte-for-byte across the move", () => {
    const root = makeTree(MONOLITH_TREE);
    try {
      const { legacy } = freezeMonolith(root, ["M2", "M3"]);
      const bodies = legacy.map((p) => read(abs(root, p)));
      expect(bodies).toContain(MONOLITH_REQUIREMENTS);
      expect(bodies).toContain(MONOLITH_PLAN);
    } finally {
      cleanup();
    }
  });

  test("the monolithic plan.md no longer sits in its old place", () => {
    const root = makeTree(MONOLITH_TREE);
    try {
      freezeMonolith(root, ["M2", "M3"]);
      expect(existsSync(join(root, "specs", "plan.md"))).toBe(false);
    } finally {
      cleanup();
    }
  });

  test("git mv when tracked: the relocation is staged, not left unstaged", () => {
    const root = makeTree(MONOLITH_TREE);
    try {
      git(root, "init", "-q");
      git(root, "config", "user.email", "t@example.com");
      git(root, "config", "user.name", "T");
      git(root, "add", "-A");
      git(root, "-c", "commit.gpgsign=false", "commit", "-qm", "seed");

      const { legacy } = freezeMonolith(root, ["M2"]);
      const porcelain = git(root, "status", "--porcelain");
      for (const p of legacy) {
        const rel = relative(root, abs(root, p));
        expect(porcelain).toContain(rel);
        // Staged: the index column (char 0) is not a space and not `?`.
        const row = porcelain.split("\n").find((l) => l.includes(rel))!;
        expect(row[0]).not.toBe(" ");
        expect(row.slice(0, 2)).not.toBe("??");
      }
      // Byte-for-byte survives git mv too.
      expect(legacy.map((p) => read(abs(root, p)))).toContain(MONOLITH_REQUIREMENTS);
    } finally {
      cleanup();
    }
  });

  test("filesystem move when untracked: a non-repo tree freezes just the same", () => {
    const root = makeTree(MONOLITH_TREE);
    try {
      expect(existsSync(join(root, ".git"))).toBe(false);
      const { legacy } = freezeMonolith(root, ["M2"]);
      expect(legacy.map((p) => read(abs(root, p)))).toContain(MONOLITH_REQUIREMENTS);
    } finally {
      cleanup();
    }
  });
});

describe("AC-STE-392.5 — a fresh cross-cutting requirements.md is scaffolded", () => {
  test("it is written at specs/requirements.md and matches the template shape", () => {
    const root = makeTree(MONOLITH_TREE);
    try {
      const { requirements } = freezeMonolith(root, ["M2", "M3"]);
      expect(relative(root, abs(root, requirements))).toBe(join("specs", "requirements.md"));
      const body = read(abs(root, requirements));
      expect(body).toMatch(/^# Requirements$/m);
      expect(body).toMatch(/## 1\. Overview/);
      expect(body).toMatch(/## 2\. Functional Requirements \(cross-cutting only\)/);
      expect(body).toMatch(/## 3\. Non-Functional Requirements/);
      expect(body).toMatch(/## 6\. Traceability Matrix/);
    } finally {
      cleanup();
    }
  });

  test("cross-cutting ONLY — no FR-heading section survives into the fresh file", () => {
    const root = makeTree(MONOLITH_TREE);
    try {
      const { requirements } = freezeMonolith(root, ["M2", "M3"]);
      const body = read(abs(root, requirements));
      expect(body).not.toMatch(/^### FR-\d+:/m);
      expect(body).not.toMatch(/AC-8\.1/);
      expect(body).not.toMatch(/AC-12\.\d/);
    } finally {
      cleanup();
    }
  });

  test("a pointer line names the legacy archive the history moved to", () => {
    const root = makeTree(MONOLITH_TREE);
    try {
      const { requirements, legacy } = freezeMonolith(root, ["M2", "M3"]);
      const body = read(abs(root, requirements));
      const legacyReq = legacy.find((p) => read(abs(root, p)) === MONOLITH_REQUIREMENTS)!;
      expect(body).toContain(relative(root, abs(root, legacyReq)));
    } finally {
      cleanup();
    }
  });
});

describe("AC-STE-392.5 — plan stubs land for open-work milestones ONLY", () => {
  test("a milestone with surviving open work gets an active specs/plan/M<N>.md stub", () => {
    const root = makeTree(MONOLITH_TREE);
    try {
      const { planStubs } = freezeMonolith(root, ["M2", "M3"]);
      expect(planStubs.map((p) => basename(abs(root, p))).sort()).toEqual(["M2.md", "M3.md"]);
      expect(existsSync(join(root, "specs", "plan", "M2.md"))).toBe(true);
      expect(existsSync(join(root, "specs", "plan", "M3.md"))).toBe(true);
    } finally {
      cleanup();
    }
  });

  test("a fully-shipped milestone stays frozen — no stub is minted for it", () => {
    // M1 is entirely `[x]`. Its stub would be an empty active file claiming
    // work that shipped years ago.
    const root = makeTree(MONOLITH_TREE);
    try {
      const { planStubs } = freezeMonolith(root, ["M2", "M3"]);
      expect(planStubs.map((p) => basename(abs(root, p)))).not.toContain("M1.md");
      expect(existsSync(join(root, "specs", "plan", "M1.md"))).toBe(false);
    } finally {
      cleanup();
    }
  });

  test("the stub carries the remaining work, keyed by the legacy M-number", () => {
    const root = makeTree(MONOLITH_TREE);
    try {
      freezeMonolith(root, ["M2", "M3"]);
      const m2 = read(join(root, "specs", "plan", "M2.md"));
      expect(m2).toMatch(/AC-12\.2/);
      expect(m2).toMatch(/AC-12\.3/);
      const m3 = read(join(root, "specs", "plan", "M3.md"));
      expect(m3).toMatch(/AC-31\.1/);
    } finally {
      cleanup();
    }
  });

  test("the stub carries ONLY the remaining work — a shipped AC is dropped", () => {
    // The other half of "remaining": AC-12.1 is `[x]` in the legacy plan, so it
    // must not reappear. A stub that re-listed shipped ACs would hand the
    // operator a milestone reading as barely started, and the shipped history is
    // already frozen in the archive. Asserting only that the unchecked rows
    // SURVIVE leaves the checked-row filter mutation-undetected.
    const root = makeTree(MONOLITH_TREE);
    try {
      freezeMonolith(root, ["M2", "M3"]);
      const m2 = read(join(root, "specs", "plan", "M2.md"));
      expect(m2).not.toMatch(/AC-12\.1/);
    } finally {
      cleanup();
    }
  });
});

describe("AC-STE-392.5 — an empty open set is a LEGAL outcome (freeze-everything)", () => {
  test("zero open FRs ⇒ zero plan stubs", () => {
    // The pilot's path: the operator confirmed every unchecked AC is actually
    // complete, so nothing survives to be split.
    const root = makeTree(MONOLITH_TREE);
    try {
      const { planStubs } = freezeMonolith(root, []);
      expect(planStubs).toEqual([]);
      expect(listFiles(join(root, "specs", "plan"))).toEqual([]);
    } finally {
      cleanup();
    }
  });

  test("zero open FRs ⇒ zero active per-FR files", () => {
    const root = makeTree(MONOLITH_TREE);
    try {
      freezeMonolith(root, []);
      expect(listFiles(join(root, "specs", "frs")).filter((f) => !f.includes("archive"))).toEqual([]);
    } finally {
      cleanup();
    }
  });

  test("freeze-everything still archives the history and scaffolds the fresh file", () => {
    const root = makeTree(MONOLITH_TREE);
    try {
      const { legacy, requirements } = freezeMonolith(root, []);
      expect(legacy.map((p) => read(abs(root, p)))).toContain(MONOLITH_REQUIREMENTS);
      expect(read(abs(root, requirements))).toMatch(/## 2\. Functional Requirements \(cross-cutting only\)/);
    } finally {
      cleanup();
    }
  });
});
