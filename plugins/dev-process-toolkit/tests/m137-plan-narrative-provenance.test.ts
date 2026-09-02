// m137-plan-narrative-provenance — the plan word cap does not fire on prose
// written before it was policy.
//
// WHY THIS IS NOT "A MISSING EPOCH". A consumer upgrading the toolkit has
// ACTIVE plans authored long before this cap existed. Measured before the fix:
// two plans dated 2026-01-15, against an epoch of 2026-09-01, both GATE FAILED
// at error severity — and one declared `kind: legacy`, the operator's
// documented permanent manual escape, honoured by
// `plan_identity_mode_conditional` and the reason STE-443's accepted exposure
// is acceptable at all. This scanner graded straight through it.
//
// A consumer who applies the documented remedy and still gets a red gate has
// been told a lie by the tool. That is worse than a cap with no epoch, and it
// is why the verdict question came back the OPPOSITE way from STE-443: there an
// existing decision made building wrong, here it makes building mandatory.

import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  PLAN_NARRATIVE_WORD_CAP,
  classifyPlanNarrativeProvenance,
  runPlanNarrativeAltitudeProbe,
  scanPlanNarrativeAltitude,
} from "../adapters/_shared/src/scan_plan_narrative_altitude";
import {
  FR_WORD_CAP_EPOCH,
  classifyFrProvenance,
} from "../adapters/_shared/src/scan_fr_summary_altitude";
import { classifyPlanProvenance } from "../adapters/_shared/src/plan_identity_mode_conditional";

const roots: string[] = [];
function git(root: string, args: string[], env: Record<string, string> = {}): void {
  execFileSync("git", args, {
    cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", ...env },
  });
}
const overCap = (): string =>
  Array.from({ length: PLAN_NARRATIVE_WORD_CAP + 60 }, () => "word").join(" ");

/** A project with plans committed at `at`; `kinds` names any `kind:` frontmatter. */
function makeProject(at: string, plans: { name: string; kind?: string }[]): string {
  const root = mkdtempSync(join(tmpdir(), "plan-prov-"));
  roots.push(root);
  mkdirSync(join(root, "specs", "plan"), { recursive: true });
  for (const p of plans) {
    const fm = p.kind === undefined ? "" : `---\nkind: ${p.kind}\n---\n\n`;
    writeFileSync(join(root, "specs", "plan", p.name), `${fm}# ${p.name}\n\n### Rationale\n\n${overCap()}\n`);
  }
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.email", "fixture@example.invalid"]);
  git(root, ["config", "user.name", "Fixture"]);
  git(root, ["config", "commit.gpgsign", "false"]);
  git(root, ["add", "--", "."]);
  git(root, ["commit", "-q", "-m", "chore: plans"], { GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at });
  return root;
}
function cleanup(): void {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
}
const before = (): string => new Date(Date.parse(FR_WORD_CAP_EPOCH) - 86_400_000 * 200).toISOString();
const after = (): string => new Date(Date.parse(FR_WORD_CAP_EPOCH) + 86_400_000 * 5).toISOString();

describe("the plan word cap is graded against an epoch", () => {
  test("a PRE-EPOCH plan is spared, and named rather than silently dropped", () => {
    const root = makeProject(before(), [{ name: "M6.md" }]);
    const report = runPlanNarrativeAltitudeProbe(root);
    expect(scanPlanNarrativeAltitude(root).length, "the raw scanner still sees it").toBeGreaterThan(0);
    expect(report.violations, "the graded arm spares it").toEqual([]);
    expect(report.grandfathered.some((f) => f.includes("M6"))).toBe(true);
    expect(report.grandfatheredRows, "spared rows are counted in the same unit as violations")
      .toBeGreaterThan(0);
    cleanup();
  });

  test("a POST-EPOCH plan still fails at error — this is not a blanket amnesty", () => {
    // Without this leg the epoch could spare everything and look correct.
    const root = makeProject(after(), [{ name: "M7.md" }]);
    const report = runPlanNarrativeAltitudeProbe(root);
    expect(report.violations.length).toBeGreaterThan(0);
    expect(report.violations.every((v) => v.severity === "error")).toBe(true);
    expect(report.grandfathered).toEqual([]);
    cleanup();
  });

  test("`kind: legacy` spares a plan git would call FRESH — the hatch outranks git", () => {
    // The documented promise: a permanent, manual escape, whatever git says.
    const root = makeProject(after(), [{ name: "M8.md", kind: "legacy" }]);
    expect(classifyPlanNarrativeProvenance(root, "M8.md")).toBe("legacy");
    expect(runPlanNarrativeAltitudeProbe(root).violations).toEqual([]);
    cleanup();
  });

  test("`kind: scaffolding` does too — both kinds, not just the one", () => {
    const root = makeProject(after(), [{ name: "M9.md", kind: "scaffolding" }]);
    expect(runPlanNarrativeAltitudeProbe(root).violations).toEqual([]);
    cleanup();
  });

  test("a plan with an UNRELATED kind is NOT spared — the list is closed", () => {
    const root = makeProject(after(), [{ name: "M10.md", kind: "milestone" }]);
    expect(runPlanNarrativeAltitudeProbe(root).violations.length).toBeGreaterThan(0);
    cleanup();
  });

  test("a NON-GIT tree is spared — a consumer without git did not opt into dating", () => {
    const root = mkdtempSync(join(tmpdir(), "plan-nogit-"));
    roots.push(root);
    mkdirSync(join(root, "specs", "plan"), { recursive: true });
    writeFileSync(join(root, "specs", "plan", "M11.md"), `# M11\n\n### Rationale\n\n${overCap()}\n`);
    expect(runPlanNarrativeAltitudeProbe(root).violations).toEqual([]);
    cleanup();
  });
});

describe("a truncated history cannot date a plan, and must not guess", () => {
  test("a SHALLOW clone downgrades to warning — never error, never silent", () => {
    // K3's lesson carried rather than re-learned: a shallow clone does not fail
    // the date query, it returns the GRAFT date, so every legacy plan would read
    // `fresh` and hard-fail in CI where `actions/checkout` defaults to depth 1.
    const origin = makeProject(before(), [{ name: "M6.md" }]);
    const shallow = `${origin}-shallow`;
    roots.push(shallow);
    execFileSync("git", ["clone", "--quiet", "--depth", "1", `file://${origin}`, shallow], {
      encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
    });
    const report = runPlanNarrativeAltitudeProbe(shallow);
    expect(report.violations.length, "it must not go silent").toBeGreaterThan(0);
    expect(report.violations.every((v) => v.severity === "warning"),
      "an operator whose history is severed cannot fix that by rewriting a subsection").toBe(true);
    cleanup();
  });

  test("`kind: legacy` still spares a plan in a shallow clone", () => {
    // The hatch is read before git is asked at all, so the documented remedy
    // works in exactly the tree where dating fails. That ordering is the whole
    // reason the remedy is worth documenting.
    const origin = makeProject(before(), [{ name: "M8.md", kind: "legacy" }]);
    const shallow = `${origin}-shallow2`;
    roots.push(shallow);
    execFileSync("git", ["clone", "--quiet", "--depth", "1", `file://${origin}`, shallow], {
      encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
    });
    expect(runPlanNarrativeAltitudeProbe(shallow).violations).toEqual([]);
    cleanup();
  });
});

describe("new work is FRESH, not undecidable — the siblings' disposition", () => {
  // THE DEFECT THIS PINS, and why `undecidable` was the wrong answer rather
  // than merely a different one. `classifyFrProvenance` and
  // `classifyPlanProvenance` both return `fresh` for a file git does not track
  // and for one staged but never committed. This module returned `undecidable`,
  // because "no introducing commit" collapsed two different facts: a file with
  // no history because it is NEW, and one with no history because the object
  // store is SEVERED.
  //
  // The consequence ran backwards. `undecidable` downgrades to `warning` and
  // `fresh` reports at `error` — so a plan the operator had just written, the
  // newest thing in the tree and exactly what a cap exists to bind, escaped
  // with a warning while an old committed plan got the error.
  //
  // EVERY LEG HERE FAILS UNDER `undecidable`, deliberately: each asserts the
  // class is `fresh` AND that the row reports at `error`. An assertion that
  // passed under both values would pin nothing, and this is a disposition —
  // the severity IS the behaviour.

  function seeded(): string {
    const root = mkdtempSync(join(tmpdir(), "plan-prov-new-"));
    roots.push(root);
    mkdirSync(join(root, "specs", "plan"), { recursive: true });
    git(root, ["init", "-q", "-b", "main"]);
    git(root, ["config", "user.email", "fixture@example.invalid"]);
    git(root, ["config", "user.name", "Fixture"]);
    git(root, ["config", "commit.gpgsign", "false"]);
    writeFileSync(join(root, "README.md"), "seed\n");
    git(root, ["add", "--", "README.md"]);
    git(root, ["commit", "-q", "-m", "chore: seed"], { GIT_AUTHOR_DATE: before(), GIT_COMMITTER_DATE: before() });
    return root;
  }

  test("an UNTRACKED plan is fresh and reports at error", () => {
    const root = seeded();
    writeFileSync(join(root, "specs", "plan", "M50.md"), `# M50\n\n### Rationale\n\n${overCap()}\n`);
    expect(classifyPlanNarrativeProvenance(root, "M50.md")).toBe("fresh");
    const report = runPlanNarrativeAltitudeProbe(root);
    expect(report.violations.length, "a brand-new over-cap plan must be reported").toBeGreaterThan(0);
    expect(report.violations.every((v) => v.severity === "error"),
      "error, not the warning `undecidable` would produce").toBe(true);
    expect(report.grandfathered, "and nothing is spared").toEqual([]);
    cleanup();
  });

  test("a STAGED-but-never-committed plan is fresh and reports at error", () => {
    const root = seeded();
    writeFileSync(join(root, "specs", "plan", "M51.md"), `# M51\n\n### Rationale\n\n${overCap()}\n`);
    git(root, ["add", "--", "specs/plan/M51.md"]);
    expect(classifyPlanNarrativeProvenance(root, "M51.md")).toBe("fresh");
    const report = runPlanNarrativeAltitudeProbe(root);
    // NON-VACUITY FIRST, and it is the load-bearing half. `.every()` on an
    // empty array is `true` and `grandfathered` is `[]` when nothing was
    // graded, so without this guard a probe reporting NOTHING satisfies both
    // clauses below — and the severity clause is exactly what this leg is for,
    // since undecidable->warning versus fresh->error IS the defect.
    expect(report.violations.length, "a staged over-cap plan must be reported").toBeGreaterThan(0);
    expect(report.violations.every((v) => v.severity === "error"),
      "error, not the warning `undecidable` would produce").toBe(true);
    expect(report.grandfathered).toEqual([]);
    cleanup();
  });

  test("the three modules AGREE on BOTH branches — parity asserted, not assumed", () => {
    // BOTH branches, because the first version of this leg exercised only the
    // UNTRACKED case while claiming to cover any re-introduced divergence.
    // Measured: mutating the plan module's STAGED branch to `undecidable` left
    // this leg green (it reddened elsewhere, so coverage was not holed — but
    // the leg whose whole job is parity covered neither half of it).
    const root = seeded();
    mkdirSync(join(root, "specs", "frs"), { recursive: true });
    const planOf = (n: string): string => join(root, "specs", "plan", `${n}.md`);
    const frOf = (n: string): string => join(root, "specs", "frs", `${n}.md`);

    // UNTRACKED on both sides.
    writeFileSync(planOf("M52"), `# M52\n\n### Rationale\n\n${overCap()}\n`);
    writeFileSync(frOf("STE-52"), `# STE-52\n\n## Summary\n\n${overCap()}\n`);
    // STAGED but never committed on both sides.
    writeFileSync(planOf("M53"), `# M53\n\n### Rationale\n\n${overCap()}\n`);
    writeFileSync(frOf("STE-53"), `# STE-53\n\n## Summary\n\n${overCap()}\n`);
    git(root, ["add", "--", "specs/plan/M53.md", "specs/frs/STE-53.md"]);

    for (const [branch, plan, fr] of [
      ["untracked", "M52", "STE-52"],
      ["staged", "M53", "STE-53"],
    ] as const) {
      expect(classifyPlanNarrativeProvenance(root, `${plan}.md`), `${branch}: plan scanner`).toBe("fresh");
      expect(classifyFrProvenance(root, frOf(fr)), `${branch}: FR sibling`).toBe("fresh");
      expect(
        classifyPlanProvenance(root, planOf(plan), readFileSync(planOf(plan), "utf-8")),
        `${branch}: plan-identity sibling`,
      ).toBe("fresh");
    }
    cleanup();
  });
});
