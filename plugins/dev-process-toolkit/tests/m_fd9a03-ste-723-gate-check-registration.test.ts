// STE-723 (M_fd9a03) — the optimizations_reuse_only probe's registration in
// skills/gate-check/SKILL.md, placed net zero.
//
// AC-STE-723.7  row 90 is one line directly after row 89, carries no STE-<n>
//               token, and is an ordered line probe #81 (module_reachability)
//               grades reachable.
// AC-STE-723.14 net-zero placement: 356 split-lines, 87 STE-<n> tokens, row 90
//               on line 177, the #31 join on line 230, line 248's #91, and every
//               line from 231 on other than the rewritten ones keeps its trunk
//               bytes at the same number; ADMITTED_MARKER of the ste-590 suite
//               holds 723\.7.
//
// Trunk is the M_d1b4b7 merge commit 13fdf144, whose gate-check SKILL.md equals
// v3.0.0 (6c62b32c) on every line from 10 on.

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { runModuleReachabilityProbe } from "../adapters/_shared/src/module_reachability";

const PLUGIN = resolve(import.meta.dir, "..");
const REPO = resolve(PLUGIN, "..", "..");
const TRUNK = "13fdf144";
const V300 = "6c62b32c";
const GATE_CHECK = "plugins/dev-process-toolkit/skills/gate-check/SKILL.md";
const ADMIT_SUITE = join(PLUGIN, "tests", "m_79b1f6-ste-590-offers-ask-the-gate.test.ts");
const T = 120_000;

function atCommit(sha: string, rel: string): string {
  const g = spawnSync("git", ["-C", REPO, "show", `${sha}:${rel}`], { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
  if (g.status !== 0) throw new Error(`git show ${sha}:${rel} failed: ${g.stderr}`);
  return g.stdout;
}

const now = (): string => readFileSync(join(REPO, GATE_CHECK), "utf-8");
const trunk = (): string => atCommit(TRUNK, GATE_CHECK);
const steTokens = (s: string): number => (s.match(/STE-\d+/g) ?? []).length;

const ROW_90_HEAD =
  "90. **`optimizations_reuse_only`** — call `runOptimizationsReuseOnlyProbe(projectRoot)` from `adapters/_shared/src/optimizations_config.ts`.";
const NEXT_PROBE_NEW = "registering probe #91 will turn probe #81 red";
const NEXT_PROBE_OLD = "registering probe #90 will turn probe #81 red";
/** The lines from 231 on that the edit commit rewrites in place (1-based). */
const REWRITTEN_FROM_231 = new Set([248, 252, 265, 268, 336, 337]);

describe("AC-STE-723.7 row 90 is registered as an ordered, reachable line", () => {
  test("CONTROL: trunk equals v3.0.0 on this file from line 10 on (line 9 carries M_7bc805's outcome order), and its last row is 89 on line 176", () => {
    expect(trunk().split("\n").slice(9)).toEqual(atCommit(V300, GATE_CHECK).split("\n").slice(9));
    const t = trunk().split("\n");
    expect(t[175]!.startsWith("89. **`tracker_write_gate_setting`**")).toBe(true);
    expect(t.some((l) => l.startsWith("90. "))).toBe(false);
  });

  test("AC-STE-723.7 row 90 is exactly one line, directly after row 89, before the blank line ahead of `Full details:`", () => {
    const lines = now().split("\n");
    const rows = lines.flatMap((l, i) => (l.startsWith("90. ") ? [i] : []));
    expect(rows.length).toBe(1);
    const i = rows[0]!;
    expect(lines[i]!.startsWith(ROW_90_HEAD)).toBe(true);
    expect(lines[i - 1]!.startsWith("89. **`tracker_write_gate_setting`**")).toBe(true);
    expect(lines[i + 1]).toBe("");
    expect(lines[i + 2]!.startsWith("Full details:")).toBe(true);
  });

  test("AC-STE-723.7 row 90 carries no STE-<n> token and names the error severity", () => {
    const row = now().split("\n").find((l) => l.startsWith("90. ")) ?? "";
    expect(row).toContain("Severity: error");
    expect(steTokens(row)).toBe(0);
  });

  test(
    "AC-STE-723.7 probe #81 classifies the row-90 reference as ordered and grades it reachable, and stays ok",
    async () => {
      const report = await runModuleReachabilityProbe(REPO);
      const lineNo = now().split("\n").findIndex((l) => l.startsWith("90. ")) + 1;
      expect(lineNo).toBeGreaterThan(0);
      const recs = report.records.filter(
        (r) => r.surface === GATE_CHECK && r.line === lineNo && r.module.includes("optimizations_config.ts"),
      );
      // ANTI-VACUITY: the walk saw the row.
      expect(recs.length).toBeGreaterThan(0);
      for (const r of recs) expect({ refClass: r.refClass, reachable: r.reachable }).toEqual({ refClass: "ordered", reachable: true });
      expect(report.ok).toBe(true);
    },
    T,
  );
});

describe("AC-STE-723.14 net-zero placement on the gate-check edit commit", () => {
  test("AC-STE-723.14 the file measures 356 split-lines and 87 STE-<n> tokens", () => {
    expect(now().split("\n").length).toBe(356);
    expect(steTokens(now())).toBe(87);
    // Trunk measured the same, so neither count moved.
    expect(trunk().split("\n").length).toBe(356);
    expect(steTokens(trunk())).toBe(87);
  });

  test("AC-STE-723.14 row 90 sits on line 177", () => {
    expect(now().split("\n")[176]!.startsWith(ROW_90_HEAD)).toBe(true);
  });

  test("AC-STE-723.14 line 230 is exactly the trunk lines 229 and 230 joined by one space", () => {
    const t = trunk().split("\n");
    expect(t[228]).toBe("probe #31 (implement-invocation-grammar-doc) by");
    expect(t[229]).toBe("`tests/gate-check-implement-invocation-grammar-doc.test.ts`,");
    expect(now().split("\n")[229]).toBe(`${t[228]} ${t[229]}`);
  });

  test("AC-STE-723.14 line 248 names `registering probe #91 will turn probe #81 red` and no longer #90", () => {
    const line = now().split("\n")[247]!;
    expect(trunk().split("\n")[247]).toContain(NEXT_PROBE_OLD);
    expect(line).toContain(NEXT_PROBE_NEW);
    expect(line).not.toContain(NEXT_PROBE_OLD);
    // Rewritten in place: the line is its trunk bytes with the one number moved.
    expect(line).toBe(trunk().split("\n")[247]!.replace(NEXT_PROBE_OLD, NEXT_PROBE_NEW));
  });

  test("AC-STE-723.14 every line from 231 on other than 248, 252, 265, 268, 336 and 337 equals its trunk bytes at the same number", () => {
    const t = trunk().split("\n");
    const c = now().split("\n");
    const bad: number[] = [];
    for (let n = 231; n <= Math.max(t.length, c.length); n++) {
      if (REWRITTEN_FROM_231.has(n)) continue;
      if (c[n - 1] !== t[n - 1]) bad.push(n);
    }
    expect(bad).toEqual([]);
    // The rewritten ones did change, so the exclusion list is not wider than the edit.
    const unchanged = [...REWRITTEN_FROM_231].filter((n) => c[n - 1] === t[n - 1]);
    expect(unchanged).toEqual([]);
  });

  // Amended by AC-STE-735.3 (operator ruling 2026-11-10): line 149 is probe #62
  // spawn_pattern_allowlist's entry, rewritten in place to state the scaffold
  // scope. It is the only line of 1-176 admitted to differ, and only as that entry.
  const REWRITTEN_IN_PLACE_BY_735 = 149;
  const PROBE_62_HEAD = /^62\. \*\*`spawn_pattern_allowlist`\*\*/;

  /** Lines 1-176 vs trunk (149 admitted only as the probe #62 entry naming the scaffold scope), then 178-229 vs trunk's 177-228. */
  function headDrift(t: readonly string[], c: readonly string[]): number[] {
    const bad: number[] = [];
    for (let n = 1; n <= 176; n++) {
      if (c[n - 1] === t[n - 1]) continue;
      const i = n - 1;
      const admitted =
        n === REWRITTEN_IN_PLACE_BY_735 &&
        PROBE_62_HEAD.test(t[i]!) &&
        PROBE_62_HEAD.test(c[i]!) &&
        c[i]!.includes("Scoped to the scaffold:");
      if (!admitted) bad.push(n);
    }
    for (let n = 178; n <= 229; n++) if (c[n - 1] !== t[n - 2]) bad.push(n);
    return bad;
  }

  test("AC-STE-723.14 + AC-STE-735.3 lines 1-176 keep their trunk bytes (149 rewritten in place as probe #62's entry), and 178-229 are trunk's 177-228 one line down", () => {
    expect(headDrift(trunk().split("\n"), now().split("\n"))).toEqual([]);
  });

  test("CONTROL (AC-STE-735.3): a changed 148 or 150 is reported, and 149 is reported when it stops naming the scaffold scope", () => {
    const t = trunk().split("\n");
    const c = now().split("\n");
    const n148 = [...c];
    n148[147] = `${n148[147]}x`;
    expect(headDrift(t, n148)).toEqual([148]);
    const n150 = [...c];
    n150[149] = `${n150[149]}x`;
    expect(headDrift(t, n150)).toEqual([150]);
    const unscoped = [...c];
    unscoped[148] = `${t[148]} (edited)`;
    expect(headDrift(t, unscoped)).toEqual([149]);
    const moved = [...c];
    moved[148] = `63. Scoped to the scaffold: ${c[148]}`;
    expect(headDrift(t, moved)).toEqual([149]);
  });

  test("CONTROL: a one-byte edit on an unrewritten line from 231 on is reported", () => {
    const t = trunk().split("\n");
    const c = [...t];
    c[299] = `${c[299]}x`;
    const bad: number[] = [];
    for (let n = 231; n <= t.length; n++) if (!REWRITTEN_FROM_231.has(n) && c[n - 1] !== t[n - 1]) bad.push(n);
    expect(bad).toEqual([300]);
  });

  test("AC-STE-723.14 ADMITTED_MARKER of the ste-590 suite holds 723\\.7 beside its Amended-by comment", () => {
    const line = readFileSync(ADMIT_SUITE, "utf-8").split("\n").find((l) => l.startsWith("const ADMITTED_MARKER = /")) ?? "";
    const m = /^const ADMITTED_MARKER = \/(.+)\/;/.exec(line);
    expect(m).not.toBeNull();
    const re = new RegExp(m![1]!);
    expect(re.test("// Amended by AC-STE-723.7: 89 -> 90.")).toBe(true);
    expect(re.test("// Amended by AC-STE-723.8")).toBe(false);
    expect(line).toContain("Amended by AC-STE-723.7 (M_fd9a03)");
  });
});
