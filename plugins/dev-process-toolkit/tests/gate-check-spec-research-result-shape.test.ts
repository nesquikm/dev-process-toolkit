// Tests for /gate-check probe `spec_research_result_shape`
// (STE-230 AC-STE-230.12). Severity: error. Probe #41.
//
// Builds tmp fixtures under .dpt/scratch/<ulid>/spec-research-result.txt
// and asserts the probe surfaces banner / section-order / line-cap
// drift while passing on canonical blocks. Vacuous when no log file
// exists.
//
// M104 STE-382 AC-STE-382.5 — research scratch moved out of the TRACKED
// `.dpt-locks/` namespace into the ignored `.dpt/scratch/`. The probe now
// walks `.dpt/scratch/**` via `dpt_paths`. Vacuity is load-bearing and
// preserved verbatim: an absent scratch dir ⇒ pass with no note (the
// STE-230 AC-STE-230.12 contract), so a run that invoked no research fork
// stays green.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dptRoot, scratchDir } from "../adapters/_shared/src/dpt_paths";
import {
  SPEC_RESEARCH_BANNER,
  SPEC_RESEARCH_SECTIONS,
  runSpecResearchResultShapeProbe,
} from "../adapters/_shared/src/spec_research_result_shape";

interface Fixture {
  ulid: string;
  content: string;
}

function makeFixture(blocks: Fixture[]): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "spec-research-shape-probe-"));
  for (const b of blocks) {
    const dir = scratchDir(root, b.ulid);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "spec-research-result.txt"), b.content);
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function canonicalBlock(): string {
  return [
    SPEC_RESEARCH_BANNER,
    "```spec-research-result",
    "## Related FRs",
    "- STE-225 (archived) — context-fork pattern — relevant: forked subagents",
    "",
    "## Prior Decisions",
    "- subagents are read-only and discard intermediate state on exit",
    "",
    "## Reusable ACs / Patterns",
    "- STE-225:AC-3 — context: fork frontmatter with explicit agent: pin",
    "```",
    "",
  ].join("\n");
}

// -----------------------------------------------------------------------------
// Vacuous cases — AC-STE-382.5 keeps the AC-STE-230.12 vacuity contract.
// VACUITY IS LOAD-BEARING: a no-research-fork run must stay green.
// -----------------------------------------------------------------------------

describe("spec_research_result_shape — vacuous", () => {
  test("project root with no .dpt/ tree at all → no violations", () => {
    const root = mkdtempSync(join(tmpdir(), "spec-research-shape-vacuous-"));
    try {
      const report = runSpecResearchResultShapeProbe(root);
      expect(report.violations).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test(".dpt/ exists but .dpt/scratch/ is absent → no violations (no research fork ran)", () => {
    const root = mkdtempSync(join(tmpdir(), "spec-research-shape-no-scratch-"));
    try {
      // The common shape: locks and/or ledger present, scratch never created.
      mkdirSync(join(dptRoot(root), "locks"), { recursive: true });
      mkdirSync(join(dptRoot(root), "ledger"), { recursive: true });
      const report = runSpecResearchResultShapeProbe(root);
      expect(report.violations).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test(".dpt/scratch/ exists but no spec-research-result.txt → no violations", () => {
    const root = mkdtempSync(join(tmpdir(), "spec-research-shape-empty-"));
    try {
      mkdirSync(scratchDir(root, "01H123"), { recursive: true });
      writeFileSync(join(scratchDir(root, "01H123"), "other.txt"), "noise\n");
      const report = runSpecResearchResultShapeProbe(root);
      expect(report.violations).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a legacy .dpt-locks/ result log is NOT scanned (forward-only, no fallback)", () => {
    const root = mkdtempSync(join(tmpdir(), "spec-research-shape-legacy-"));
    try {
      // A broken block at the OLD site. Zero installs ⇒ forward-only: the probe
      // reads the new tree only, so this must not surface as a violation.
      mkdirSync(join(root, ".dpt-locks", "01HOLD"), { recursive: true });
      writeFileSync(
        join(root, ".dpt-locks", "01HOLD", "spec-research-result.txt"),
        "## not even close\n",
      );
      const report = runSpecResearchResultShapeProbe(root);
      expect(report.violations).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// -----------------------------------------------------------------------------
// Positive case — a fully canonical block passes.
// -----------------------------------------------------------------------------

describe("spec_research_result_shape — positive", () => {
  test("canonical block (banner + 3 sections in order + ≤25 lines) → no violations", () => {
    const { root, cleanup } = makeFixture([
      { ulid: "01H1AB", content: canonicalBlock() },
    ]);
    try {
      const report = runSpecResearchResultShapeProbe(root);
      expect(report.violations).toEqual([]);
    } finally {
      cleanup();
    }
  });

  test("flat layout (.dpt/scratch/spec-research-result.txt) is also recognized", () => {
    const root = mkdtempSync(join(tmpdir(), "spec-research-shape-flat-"));
    try {
      mkdirSync(join(dptRoot(root), "scratch"), { recursive: true });
      writeFileSync(
        join(dptRoot(root), "scratch", "spec-research-result.txt"),
        canonicalBlock(),
      );
      const report = runSpecResearchResultShapeProbe(root);
      expect(report.violations).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("flat-fallback drift IS caught (the walk really reaches the flat path)", () => {
    // Guards the flat leg against becoming a silent no-op: a broken block at
    // `.dpt/scratch/spec-research-result.txt` must still surface.
    const root = mkdtempSync(join(tmpdir(), "spec-research-shape-flat-bad-"));
    try {
      mkdirSync(join(dptRoot(root), "scratch"), { recursive: true });
      writeFileSync(
        join(dptRoot(root), "scratch", "spec-research-result.txt"),
        "## not even close\n",
      );
      const report = runSpecResearchResultShapeProbe(root);
      expect(report.violations.length).toBeGreaterThan(0);
      expect(report.violations[0]!.severity).toBe("error");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// -----------------------------------------------------------------------------
// Negative cases — every shape failure surfaces a violation.
// -----------------------------------------------------------------------------

describe("spec_research_result_shape — negative", () => {
  test("missing banner line → violation", () => {
    const content = [
      "```spec-research-result",
      "## Related FRs",
      "- (none found)",
      "## Prior Decisions",
      "- (none found)",
      "## Reusable ACs / Patterns",
      "- (none found)",
      "```",
      "",
    ].join("\n");
    const { root, cleanup } = makeFixture([{ ulid: "01H1NB", content }]);
    try {
      const report = runSpecResearchResultShapeProbe(root);
      expect(report.violations.length).toBeGreaterThan(0);
      expect(
        report.violations.some((v) => /banner/i.test(v.reason)),
      ).toBe(true);
    } finally {
      cleanup();
    }
  });

  test("section order swapped → violation cites the offending heading", () => {
    const content = [
      SPEC_RESEARCH_BANNER,
      "```spec-research-result",
      "## Prior Decisions", // out-of-order
      "- (none found)",
      "## Related FRs",
      "- (none found)",
      "## Reusable ACs / Patterns",
      "- (none found)",
      "```",
      "",
    ].join("\n");
    const { root, cleanup } = makeFixture([{ ulid: "01H1NS", content }]);
    try {
      const report = runSpecResearchResultShapeProbe(root);
      const offenders = report.violations.filter((v) =>
        /heading at this position/i.test(v.reason),
      );
      expect(offenders.length).toBeGreaterThan(0);
      expect(offenders[0]!.reason).toContain("## Prior Decisions");
      expect(offenders[0]!.reason).toContain("expected `## Related FRs`");
    } finally {
      cleanup();
    }
  });

  test("missing third section → violation surfaces the section count", () => {
    const content = [
      SPEC_RESEARCH_BANNER,
      "```spec-research-result",
      "## Related FRs",
      "- (none found)",
      "## Prior Decisions",
      "- (none found)",
      "```",
      "",
    ].join("\n");
    const { root, cleanup } = makeFixture([{ ulid: "01H1NM", content }]);
    try {
      const report = runSpecResearchResultShapeProbe(root);
      expect(
        report.violations.some((v) => /found 2/.test(v.reason)),
      ).toBe(true);
    } finally {
      cleanup();
    }
  });

  test("> 25-line block → violation cites the line count", () => {
    const lines: string[] = [SPEC_RESEARCH_BANNER, "```spec-research-result"];
    for (const heading of SPEC_RESEARCH_SECTIONS) {
      lines.push(heading);
      // pad each section with ten bullets so the block easily exceeds 25 lines
      for (let i = 0; i < 10; i++) {
        lines.push(`- bullet ${i} text padding`);
      }
    }
    lines.push("```");
    lines.push("");
    const { root, cleanup } = makeFixture([
      { ulid: "01H1NL", content: lines.join("\n") },
    ]);
    try {
      const report = runSpecResearchResultShapeProbe(root);
      const cap = report.violations.find((v) =>
        /≤ 25-line cap is exceeded/.test(v.reason),
      );
      expect(cap).toBeDefined();
      expect(cap!.reason).toMatch(/^block is \d+ lines/);
    } finally {
      cleanup();
    }
  });

  test("missing opening fence → violation cites the missing fence", () => {
    const content = [
      SPEC_RESEARCH_BANNER,
      "## Related FRs",
      "- (none found)",
      "",
    ].join("\n");
    const { root, cleanup } = makeFixture([{ ulid: "01H1NF", content }]);
    try {
      const report = runSpecResearchResultShapeProbe(root);
      expect(
        report.violations.some((v) =>
          /missing opening fence/.test(v.reason),
        ),
      ).toBe(true);
    } finally {
      cleanup();
    }
  });

  test("missing closing fence → violation cites the unclosed block", () => {
    const content = [
      SPEC_RESEARCH_BANNER,
      "```spec-research-result",
      "## Related FRs",
      "- (none found)",
      "## Prior Decisions",
      "- (none found)",
      "## Reusable ACs / Patterns",
      "- (none found)",
      "",
    ].join("\n");
    const { root, cleanup } = makeFixture([{ ulid: "01H1NC", content }]);
    try {
      const report = runSpecResearchResultShapeProbe(root);
      expect(
        report.violations.some((v) =>
          /missing closing fence/.test(v.reason),
        ),
      ).toBe(true);
    } finally {
      cleanup();
    }
  });
});

// -----------------------------------------------------------------------------
// Severity / message shape — error severity, NFR-10 canonical shape.
// -----------------------------------------------------------------------------

describe("spec_research_result_shape — message shape", () => {
  test("violation carries severity=error and NFR-10 canonical message", () => {
    const content = "## not even close\n";
    const { root, cleanup } = makeFixture([{ ulid: "01H1MS", content }]);
    try {
      const report = runSpecResearchResultShapeProbe(root);
      expect(report.violations.length).toBeGreaterThan(0);
      const v = report.violations[0]!;
      expect(v.severity).toBe("error");
      expect(v.message).toContain("spec_research_result_shape:");
      expect(v.message).toContain("Remedy:");
      expect(v.message).toContain("Context:");
      expect(v.message).toContain("severity=error");
    } finally {
      cleanup();
    }
  });
});

// -----------------------------------------------------------------------------
// Constants — sanity-check the byte-exact canonicals exported by the module.
// -----------------------------------------------------------------------------

describe("spec_research_result_shape — constants", () => {
  test("SPEC_RESEARCH_BANNER matches the literal AC-STE-230.3 line", () => {
    expect(SPEC_RESEARCH_BANNER).toBe(
      "> [historical reference — decisions below may be stale; use as background, not authority]",
    );
  });

  test("SPEC_RESEARCH_SECTIONS is the canonical 3-section list in order", () => {
    expect(SPEC_RESEARCH_SECTIONS).toEqual([
      "## Related FRs",
      "## Prior Decisions",
      "## Reusable ACs / Patterns",
    ]);
  });
});

// R2 (docs audit, 2026-09-23) — deferred at the time, FIXED in STE-648.
//
// `/gate-check`'s probe #41 entry called `commit_producing_skill_branch_gate` a
// colocated sibling "added in M61". That module exists and NO numbered entry
// registers it, so nothing runs it, and a reader checking whether the branch
// gate is guarded found a sentence saying yes.
//
// WHY IT WAS DEFERRED. Correcting it edits `skills/gate-check/SKILL.md`, which
// AC-STE-618.8 freezes byte-for-byte against the kickoff except ONE permitted
// line — and the closed list of amendments across this milestone already holds
// two, so a third would cross that FR's recorded threshold for rethinking the
// pin rather than widening it. The edit was made, the pin refused it, and it
// was reverted rather than amending a closed list for the author's own change;
// the correction was deferred to the follow-on milestone.
//
// FIXED in STE-648 (M_163656). Operator ruling R2 split the two halves: the
// sentence is corrected now WITHOUT registering the probe, and the
// AC-STE-618.8 freeze admits line 120 by name. The rows below therefore assert
// the CORRECTED state; the MEASURED row still pins that the module ships
// unregistered, so a future registration reds it and forces this row's rewrite.
describe("R2 — FIXED (STE-648): gate-check no longer claims a probe that does not run", () => {
  const skill = () => readFileSync(join(import.meta.dir, "..", "skills", "gate-check", "SKILL.md"), "utf-8");

  test("MEASURED — the module exists and no numbered entry registers it", () => {
    const root = join(import.meta.dir, "..");
    expect(existsSync(join(root, "adapters", "_shared", "src", "commit_producing_skill_branch_gate.ts")), "the module ships").toBe(true);
    const numbered = skill().split("\n").filter((l) => /^\d+\.\s+\*\*`/.test(l));
    expect(numbered.length, "the document has a numbered probe list").toBeGreaterThan(50);
    expect(numbered.filter((l) => /^\d+\.\s+\*\*`commit_producing_skill_branch_gate`\*\*/.test(l)), "none registers it").toEqual([]);
  });

  // AC-STE-648.7 — the corrected state, per operator ruling R2: the sentence is
  // corrected WITHOUT registering the probe (the MEASURED leg above still holds).
  test("AC-STE-648.7: the false 'colocated … probe' claim is gone from the shipped document", () => {
    expect(skill()).not.toContain("colocated with the `commit_producing_skill_branch_gate` probe");
    const probeClaim = /`commit_producing_skill_branch_gate`\s+probe|probe\s+`commit_producing_skill_branch_gate`/;
    expect(skill().split("\n").filter((l) => probeClaim.test(l)), "no line calls the module a probe").toEqual([]);
  });

  test("AC-STE-648.7: probe #41's entry states the module is unregistered and /gate-check does not run it", () => {
    const entry = skill().split("\n").find((l) => /^41\.\s+\*\*`spec_research_result_shape`\*\*/.test(l));
    expect(entry, "probe #41's entry is found").not.toBeUndefined();
    expect(entry!).toContain(
      "Sibling module: `commit_producing_skill_branch_gate` (M61) — no numbered entry registers it, so /gate-check does not run it.",
    );
  });
});

// AC-STE-648.5 / AC-STE-648.6 — no shipped surface calls the unregistered
// `commit_producing_skill_branch_gate` module a /gate-check probe. The SKILL
// keeps its line count and STE-token count (absolute line-position pins).
const PROBE_CLAIM =
  /`commit_producing_skill_branch_gate`\s+probe|probe\s+`commit_producing_skill_branch_gate`|\/gate-check`?\s+probe\s+`?commit_producing_skill_branch_gate/;

describe("AC-STE-648.5 — gate-check SKILL.md stops calling the branch-gate module a probe", () => {
  const skill = () => readFileSync(join(import.meta.dir, "..", "skills", "gate-check", "SKILL.md"), "utf-8");

  test("AC-STE-648.5: no line of gate-check SKILL.md calls commit_producing_skill_branch_gate a /gate-check probe", () => {
    const mentions = skill().split("\n").filter((l) => l.includes("commit_producing_skill_branch_gate"));
    expect(mentions.length, "CONTROL: the module is still named (the sentence is corrected, not deleted)").toBeGreaterThan(0);
    expect(mentions.filter((l) => PROBE_CLAIM.test(l))).toEqual([]);
  });

  test("AC-STE-648.5 CONTROL: the SKILL still has 356 split-lines and 87 STE tokens", () => {
    const body = skill();
    expect(body.split("\n").length).toBe(356);
    expect((body.match(/STE-\d+/g) ?? []).length).toBe(87);
  });

  test("AC-STE-648.5 CONTROL: the claim detector fires on the pre-fix sentence (it is not a detector that cannot fail)", () => {
    expect(PROBE_CLAIM.test("Sibling probe family: colocated with the `commit_producing_skill_branch_gate` probe added in M61.")).toBe(true);
    expect(PROBE_CLAIM.test("**Read-side safety net**: `/gate-check` probe `commit_producing_skill_branch_gate` parses each")).toBe(true);
    expect(
      PROBE_CLAIM.test("Sibling module: `commit_producing_skill_branch_gate` (M61) — no numbered entry registers it, so /gate-check does not run it."),
    ).toBe(false);
  });
});

describe("AC-STE-648.6 — docs/patterns.md stops calling the branch-gate module a /gate-check probe", () => {
  const patterns = () => readFileSync(join(import.meta.dir, "..", "docs", "patterns.md"), "utf-8");

  test("AC-STE-648.6: no line of docs/patterns.md describes commit_producing_skill_branch_gate as a /gate-check probe", () => {
    const hits = patterns().split("\n").filter((l) => l.includes("commit_producing_skill_branch_gate") && PROBE_CLAIM.test(l));
    expect(hits).toEqual([]);
  });

  test("AC-STE-648.6 CONTROL: the line describing the module stays path-free (docs/ is a reachability surface; only the **Where** inventory line names the path)", () => {
    const described = patterns()
      .split("\n")
      .filter((l) => l.includes("commit_producing_skill_branch_gate") && !l.startsWith("**Where**"));
    expect(described.length, "the module is still described outside the **Where** line").toBeGreaterThan(0);
    expect(described.filter((l) => l.includes("commit_producing_skill_branch_gate.ts"))).toEqual([]);
  });
});

// Ordered prose: a colon introduces its list, and nothing stands between them.
//
// MEASURED on this milestone's own repair commit (3a576fe), found by a reader
// who was not its author. The R1 persistence sentence was spliced into
// `spec-write/SKILL.md` AFTER "…MUST emit exactly one of the literal tokens …
// whenever the spec-research subagent fires:" and BEFORE the three token
// bullets that colon exists to introduce. A model executing the step therefore
// read "must emit exactly one of the literal tokens: persist the block to a
// file", with the bullets stranded behind a paragraph.
//
// The SIBLING is what makes it a defect rather than a taste: the deps-research
// seed two paragraphs down — which the spliced sentence itself names as the
// model to follow — puts the persist sentence with the seed's own prose and
// lets its colon touch its bullets. Two adjacent instructions for one shape,
// one right and one wrong, and the right one was the one being cited.
//
// The brainstorm arm was CHECKED and was never broken: its persist sentence
// closes the seed paragraph, which is the same ordering. A fix applied to one
// arm and not its twin is this milestone's most repeated defect, so the twin is
// asserted here rather than assumed.
describe("ordered prose — the token colon touches its token bullets", () => {
  const skill = (name: string): string => readFileSync(join(import.meta.dir, "..", "skills", name, "SKILL.md"), "utf-8");

  for (const [name, cue] of [
    ["spec-write", "whenever the spec-research subagent fires:"],
    ["spec-write", "whenever the deps-research subagent fires:"],
  ] as const) {
    test(`${name}: nothing stands between "${cue.slice(-28)}" and its first bullet`, () => {
      const text = skill(name);
      const at = text.indexOf(cue);
      expect(at, `${name} carries the cue`).toBeGreaterThanOrEqual(0);
      const after = text.slice(at + cue.length);
      // Only blank space may separate the colon from what it introduces. The two
      // sites render their lists differently — spec-research as bullets, deps as
      // inline `⇒ **MUST emit …**` clauses — so the check accepts EITHER and
      // rejects a paragraph, which is the actual defect shape.
      expect(after, "the colon is followed by its list, not by a paragraph").toMatch(/^\s*(?:[-*]\s|[^\n]{0,80}⇒\s*\*\*MUST emit)/);
    });
  }

  test("brainstorm: the persist sentence closes the seed paragraph and strands no list", () => {
    const text = skill("brainstorm");
    const at = text.indexOf("spec-research-result.txt");
    expect(at, "brainstorm persists the block").toBeGreaterThanOrEqual(0);
    const sentenceEnd = text.indexOf("\n", at);
    const rest = text.slice(at, sentenceEnd);
    expect(rest, "it is not sitting between a colon and a list").not.toMatch(/:\s*$/);
  });

  test("CONTROL — the check is not vacuous: a paragraph spliced after the cue is caught", () => {
    const text = skill("spec-write");
    const cue = "whenever the spec-research subagent fires:";
    const mutated = text.replace(cue, `${cue} A sentence that does not belong here.`);
    expect(mutated, "control: the splice applied").not.toBe(text);
    const after = mutated.slice(mutated.indexOf(cue) + cue.length);
    expect(after).not.toMatch(/^\s*(?:[-*]\s|[^\n]{0,80}⇒\s*\*\*MUST emit)/);
  });
});
