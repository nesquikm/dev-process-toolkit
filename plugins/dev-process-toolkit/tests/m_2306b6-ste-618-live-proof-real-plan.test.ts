// STE-618 — the REAL-PLAN suite (AC-STE-618.8).
//
// The live-proof gate run against this repository's own milestone plan,
// specs/plan/M_2306b6.md, and the evidence bundles its `### Live proof` table
// names. It lands in the same commit as the second leg's bundle and the filled
// table (the plan's evidence-commit task): a real-plan leg landed earlier would
// have turned every commit between the legs red. This suite is what blocks the
// release: a red suite fails /ship-milestone refusal #3.
//
// Its counterparts make it falsifiable. The same gate over a scratch root that
// differs from the real one ONLY in its plan (a row reverted to `pending`, or
// one hash byte flipped) must fail, naming why. The scratch root links the real
// plugin tree, so the bundles, the digest and the grader are the ones under
// test; a CONTROL first shows the unmutated copy passes there, so each
// counterpart fails on its mutation and nothing else.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { gradeLiveProof, parseLiveProofTable } from "../adapters/_shared/src/live_proof_gate";

const PLUGIN = join(import.meta.dir, "..");
const REPO = realpathSync(join(PLUGIN, "..", ".."));
const REAL_PLAN = "specs/plan/M_2306b6.md";
const T = 120_000;

/** The gate over a scratch root whose plan is `plan` and whose plugin tree is the real one. */
function gradeWithPlan(plan: string): ReturnType<typeof gradeLiveProof> {
  const root = mkdtempSync(join(tmpdir(), "ste618-real-"));
  try {
    mkdirSync(join(root, "specs", "plan"), { recursive: true });
    writeFileSync(join(root, REAL_PLAN), plan);
    mkdirSync(join(root, "plugins"));
    symlinkSync(PLUGIN, join(root, "plugins", "dev-process-toolkit"));
    writeFileSync(join(root, "CHANGELOG.md"), readFileSync(join(REPO, "CHANGELOG.md"), "utf-8"));
    return gradeLiveProof({ repoRoot: root, planPath: REAL_PLAN });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const planText = () => readFileSync(join(REPO, REAL_PLAN), "utf-8");

/** The plan with `tracker`'s Live proof row rewritten by `edit` (cells after the tracker). */
function withRow(tracker: "jira" | "linear", edit: (cells: string[]) => string[]): string {
  const lines = planText().split("\n");
  const at = lines.findIndex((l) => l.startsWith(`| ${tracker} |`));
  expect(at, `control: the ${tracker} Live proof row is found`).toBeGreaterThan(0);
  const cells = lines[at]!.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  lines[at] = `| ${[cells[0]!, ...edit(cells.slice(1))].join(" | ")} |`;
  return lines.join("\n");
}

describe("AC-STE-618.8 — the live-proof gate passes on the real plan and its committed bundles", () => {
  test("the real plan's Live proof table names one bundle per tracker, none pending", () => {
    const table = parseLiveProofTable(planText());
    expect(table.found && table.ok).toBe(true);
    if (!table.found || !table.ok) return;
    expect(table.rows.map((r) => r.tracker).sort()).toEqual(["jira", "linear"]);
    for (const r of table.rows) expect([r.bundle, r.date, r.nonce, r.spaces, r.hash].some((c) => c.toLowerCase() === "pending"), `${r.tracker} row`).toBe(false);
  });

  test("REAL — the gate over the real plan: verdict pass, jira pass, linear pass", () => {
    const g = gradeLiveProof({ repoRoot: REPO, planPath: REAL_PLAN });
    expect({ verdict: g.verdict, jira: g.trackers?.jira?.outcome, linear: g.trackers?.linear?.outcome }, JSON.stringify(g)).toEqual({ verdict: "pass", jira: "pass", linear: "pass" });
    // Pre-release until /ship-milestone stamps shipped_in; post-release after. Both must pass.
    expect(["pre-release", "post-release"]).toContain(g.mode);
  }, T);

  test("CONTROL — the unmutated real plan over the scratch root passes too, so each counterpart fails on its mutation alone", () => {
    expect(gradeWithPlan(planText()).verdict).toBe("pass");
  }, T);

  for (const tracker of ["jira", "linear"] as const) {
    test(`COUNTERPART — the ${tracker} row reverted to pending fails the gate as pending`, () => {
      const g = gradeWithPlan(withRow(tracker, (cells) => cells.map(() => "pending")));
      expect(g.verdict).toBe("fail");
      expect(g.trackers?.[tracker]?.reason).toBe("pending");
    }, T);

    test(`COUNTERPART — one byte of the ${tracker} row's bundle hash flipped fails the gate as bundle-altered`, () => {
      const g = gradeWithPlan(
        withRow(tracker, (cells) => {
          const hash = cells[4]!;
          const flipped = `${hash.slice(0, -1)}${hash.endsWith("0") ? "1" : "0"}`;
          expect(flipped, "control: the hash really changed").not.toBe(hash);
          return [...cells.slice(0, 4), flipped];
        }),
      );
      expect(g.verdict).toBe("fail");
      expect(g.trackers?.[tracker]?.reason).toBe("bundle-altered");
    }, T);
  }
});
