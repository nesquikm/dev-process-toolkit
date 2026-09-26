// STE-618 — the REAL-PLAN suite (AC-STE-618.8).
//
// The live-proof gate run against this repository's own milestone plan,
// M_2306b6, and the evidence bundles its `### Live proof` table names. It
// landed in the same commit as the second leg's bundle and the filled table
// (the plan's evidence-commit task): a real-plan leg landed earlier would have
// turned every commit between the legs red. This suite is what blocks the
// release: a red suite fails /ship-milestone refusal #3.
//
// The plan is found the way the gate finds it (AC-STE-618.1: "at either
// path"), through the gate's own `resolvePlan`, never a second copy of the
// rule: `specs/plan/M_2306b6.md` while active, `specs/plan/archive/` once
// archived. The archive step moved it there on the way to the release, and a
// suite pinned to the live path went red on a correct archive.
//
// Its counterparts make it falsifiable. The same gate over a scratch root that
// differs from the real one ONLY in its plan (a row reverted to `pending`, or
// one hash byte flipped) must fail, naming why. The scratch root links the real
// plugin tree, so the bundles, the digest and the grader are the ones under
// test, and it holds the plan at the path the real one resolves to. A CONTROL
// first shows the unmutated copy passes there, so each counterpart fails on
// its mutation and nothing else. The release commit's state (a `shipped_in`
// stamp and its CHANGELOG heading: post-release mode) is graded the same way.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { gradeLiveProof, parseLiveProofTable, resolvePlan } from "../adapters/_shared/src/live_proof_gate";

const PLUGIN = join(import.meta.dir, "..");
const REPO = realpathSync(join(PLUGIN, "..", ".."));
/** The plan as the acceptance row spells it; the gate resolves it at either path. */
const REAL_PLAN = "specs/plan/M_2306b6.md";
const T = 120_000;

/** The real plan, found by the gate's own resolver: its repo-relative path and its text. */
function realPlan(): { rel: string; text: string } {
  const r = resolvePlan(REPO, REAL_PLAN);
  if (!r.ok) throw new Error(`the real plan does not resolve: ${r.reason} — ${r.detail}`);
  return { rel: r.rel, text: readFileSync(r.abs, "utf-8") };
}

/**
 * The gate over a scratch root whose plan is `plan` (at the path the real plan
 * resolves to), whose plugin tree is the real one, and whose CHANGELOG is the
 * real one with `changelogHead` prepended to its first release heading.
 */
function gradeWithPlan(plan: string, changelogHead = ""): ReturnType<typeof gradeLiveProof> {
  const root = mkdtempSync(join(tmpdir(), "ste618-real-"));
  try {
    const { rel } = realPlan();
    mkdirSync(join(root, dirname(rel)), { recursive: true });
    writeFileSync(join(root, rel), plan);
    mkdirSync(join(root, "plugins"));
    symlinkSync(PLUGIN, join(root, "plugins", "dev-process-toolkit"));
    const changelog = readFileSync(join(REPO, "CHANGELOG.md"), "utf-8");
    const at = changelog.search(/^## \[/m);
    writeFileSync(join(root, "CHANGELOG.md"), changelogHead === "" || at < 0 ? changelog : `${changelog.slice(0, at)}${changelogHead}\n\n${changelog.slice(at)}`);
    return gradeLiveProof({ repoRoot: root, planPath: REAL_PLAN });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** The plan with `tracker`'s Live proof row rewritten by `edit` (cells after the tracker). */
function withRow(tracker: "jira" | "linear", edit: (cells: string[]) => string[]): string {
  const lines = realPlan().text.split("\n");
  const at = lines.findIndex((l) => l.startsWith(`| ${tracker} |`));
  expect(at, `control: the ${tracker} Live proof row is found`).toBeGreaterThan(0);
  const cells = lines[at]!.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  lines[at] = `| ${[cells[0]!, ...edit(cells.slice(1))].join(" | ")} |`;
  return lines.join("\n");
}

/** The plan as the release commit leaves it: `shipped_in` stamped. */
function stamped(version: string): string {
  const text = realPlan().text;
  const next = text.replace(/^shipped_in:.*$/m, `shipped_in: v${version}`);
  expect(next, "control: the plan carries a shipped_in line to stamp").not.toBe(text);
  return next;
}

/** One release newer than the plugin version every bundle recorded at its run. */
function nextRelease(): string {
  const v = JSON.parse(readFileSync(join(PLUGIN, ".claude-plugin", "plugin.json"), "utf-8")).version as string;
  const [x, y] = v.split(".").map(Number) as [number, number, number];
  return `${x}.${y + 1}.0`;
}

describe("AC-STE-618.8 — the live-proof gate passes on the real plan and its committed bundles", () => {
  test("the real plan resolves at exactly one of its two paths", () => {
    const r = resolvePlan(REPO, REAL_PLAN);
    expect(r.ok, r.ok ? "" : `${r.reason}: ${r.detail}`).toBe(true);
    if (r.ok) expect(["specs/plan/M_2306b6.md", "specs/plan/archive/M_2306b6.md"]).toContain(r.rel);
  });

  test("the real plan's Live proof table names one bundle per tracker, none pending", () => {
    const table = parseLiveProofTable(realPlan().text);
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
    expect(gradeWithPlan(realPlan().text).verdict).toBe("pass");
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

  // The release commit stamps `shipped_in` and adds its CHANGELOG heading; the
  // gate then grades in post-release mode. This suite must stay green there.
  test("RELEASED — the plan stamped with the next release, its CHANGELOG heading present: post-release, pass", () => {
    const v = nextRelease();
    const g = gradeWithPlan(stamped(v), `## [${v}] — 2026-09-26 — "Proven"`);
    expect({ verdict: g.verdict, mode: g.mode }, JSON.stringify(g)).toEqual({ verdict: "pass", mode: "post-release" });
  }, T);

  test("RELEASED COUNTERPART — the same stamp with no CHANGELOG heading for it fails as stamp-without-release", () => {
    const g = gradeWithPlan(stamped(nextRelease()));
    expect(g.verdict).toBe("fail");
    expect(g.reason).toBe("stamp-without-release");
  }, T);
});
