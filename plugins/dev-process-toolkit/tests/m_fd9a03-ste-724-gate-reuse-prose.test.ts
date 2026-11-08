// STE-724 (M_fd9a03) — the prose half of the reuse front door.
//
// This pass grades the archive half of AC-STE-724.20: the archived
// specs/frs/archive/STE-715.md differs from its bytes at the M_7bc805 merge
// commit only on the AC-STE-715.13 line, by one appended amendment clause,
// separated by one space as the file's existing amendment clauses are.
//
// AC-STE-724.7, .13, .21 and .22 (the gate-check SKILL.md edit, the
// CONDITIONAL_TARGETS / GUARDED_TARGETS rows, the archived STE-708 clause) land
// with the milestone's single gate-check edit commit and are graded here then.

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { REPO_ROOT } from "./_m_7bc805_gate_outcome_fixture";

/** The M_7bc805 merge commit (PR #131). */
const M7BC805_MERGE = "effc0981";
const ARCHIVE_715 = "specs/frs/archive/STE-715.md";
const AC_715_13 = "- AC-STE-715.13:";
const CLAUSE_715_13 =
  "*(Amended by AC-STE-724.20 (v3.3.0): with gate_commands: reuse effective, the gate-check receipt call prints a third line, reuse: on.)*";

function atCommit(sha: string, repoRel: string): string {
  const p = spawnSync("git", ["show", `${sha}:${repoRel}`], { cwd: REPO_ROOT, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
  if (p.status !== 0) throw new Error(`git show ${sha}:${repoRel}: ${p.stderr}`);
  return p.stdout ?? "";
}

/**
 * Every way `now` departs from `base` plus exactly one appended clause on the
 * line starting with `prefix`; empty when that is the only difference.
 */
function amendmentDrift(base: string, now: string, prefix: string, clause: string): string[] {
  const a = base.split("\n");
  const b = now.split("\n");
  const out: string[] = [];
  if (a.length !== b.length) out.push(`line count ${a.length} -> ${b.length}`);
  const targets = a.flatMap((l, i) => (l.startsWith(prefix) ? [i] : []));
  if (targets.length !== 1) out.push(`expected one ${prefix} line at the base, found ${targets.length}`);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const want = i === targets[0] ? `${a[i]} ${clause}` : a[i];
    if (b[i] !== want) out.push(`line ${i + 1} differs`);
  }
  return out;
}

describe("AC-STE-724.20 archived STE-715.md gains the AC-STE-715.13 amendment clause and nothing else", () => {
  const base = atCommit(M7BC805_MERGE, ARCHIVE_715);
  const now = readFileSync(join(REPO_ROOT, ARCHIVE_715), "utf-8");

  test("the file differs from the M_7bc805 merge commit only by the clause appended to the AC-STE-715.13 line", () => {
    expect(amendmentDrift(base, now, AC_715_13, CLAUSE_715_13)).toEqual([]);
  });

  test("the clause is joined by one space, as the file's existing amendment clauses are", () => {
    const line = now.split("\n").find((l) => l.startsWith(AC_715_13)) ?? "";
    expect(line.endsWith(` ${CLAUSE_715_13}`)).toBe(true);
    // The house separator, read off an amendment the file already carries.
    expect(base).toMatch(/\. \*\(Amended by /);
  });

  test("CONTROL: a one-byte edit elsewhere in the amended file is reported", () => {
    const amended = base
      .split("\n")
      .map((l) => (l.startsWith(AC_715_13) ? `${l} ${CLAUSE_715_13}` : l))
      .join("\n");
    expect(amendmentDrift(base, amended, AC_715_13, CLAUSE_715_13)).toEqual([]);
    const edited = amended.replace("# ", "#  ");
    expect(amendmentDrift(base, edited, AC_715_13, CLAUSE_715_13).length).toBeGreaterThan(0);
  });

  test("CONTROL: the unamended file, and the clause joined with no space, are each reported", () => {
    expect(amendmentDrift(base, base, AC_715_13, CLAUSE_715_13).length).toBeGreaterThan(0);
    const glued = base
      .split("\n")
      .map((l) => (l.startsWith(AC_715_13) ? `${l}${CLAUSE_715_13}` : l))
      .join("\n");
    expect(amendmentDrift(base, glued, AC_715_13, CLAUSE_715_13).length).toBeGreaterThan(0);
  });
});
