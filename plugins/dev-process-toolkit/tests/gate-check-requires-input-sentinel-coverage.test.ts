import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runRequiresInputSentinelCoverageProbe } from "../adapters/_shared/src/requires_input_sentinel_coverage";

// STE-232 AC-STE-232.5 — /gate-check probe `requires_input_sentinel_coverage`.
// Severity: error.
//
// Globs `plugins/dev-process-toolkit/skills/*/SKILL.md` and
// `.claude/skills/*/SKILL.md` (matching STE-226 AC.5). For every skill
// carrying a `requires-input:` annotation in its body, the probe verifies
// (a) a call to `requireOrRefuse(...)` is referenced, and
// (b) the body cites `docs/auto-mode-protocol.md` by relative path.
// Hard-fails the gate when either is missing; surfaces the
// `requires_input_sentinel_coverage_violation` capability row.
//
// Skills WITHOUT a `requires-input:` annotation are vacuously out of scope —
// the protocol doc only constrains gates that explicitly declare the
// requirement, so a documentation skill is never flagged.

function makeFixture(opts: {
  pluginSkills?: { name: string; content: string }[];
  projectSkills?: { name: string; content: string }[];
}): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "requires-input-coverage-"));
  const pluginDir = join(root, "plugins", "dev-process-toolkit", "skills");
  const projectDir = join(root, ".claude", "skills");
  mkdirSync(pluginDir, { recursive: true });
  mkdirSync(projectDir, { recursive: true });
  for (const s of opts.pluginSkills ?? []) {
    const dir = join(pluginDir, s.name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), s.content);
  }
  for (const s of opts.projectSkills ?? []) {
    const dir = join(projectDir, s.name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), s.content);
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const COMPLIANT_SETUP_SKILL = [
  "# Setup",
  "",
  "### 7b. Tracker mode (opt-in)",
  "",
  "`requires-input: tracker mode is a workspace-wide decision; no safe default exists.`",
  "",
  "Step 7b's resolver delegates to `requireOrRefuse(spec, 'tracker_mode', SENTINEL)` ",
  "from `adapters/_shared/src/requires_input.ts`. See `docs/auto-mode-protocol.md` § The Rule.",
].join("\n");

const NONCOMPLIANT_NO_HELPER = [
  "# Setup",
  "",
  "### 7b. Tracker mode (opt-in)",
  "",
  "`requires-input: tracker mode is a workspace-wide decision; no safe default exists.`",
  "",
  // Body cites the protocol doc but does NOT invoke requireOrRefuse.
  "See `docs/auto-mode-protocol.md` for the cross-skill contract.",
].join("\n");

const NONCOMPLIANT_NO_PROTOCOL_CITATION = [
  "# Setup",
  "",
  "### 7b. Tracker mode (opt-in)",
  "",
  "`requires-input: tracker mode is a workspace-wide decision; no safe default exists.`",
  "",
  // Body invokes the helper but does NOT cite the protocol doc.
  "Step 7b's resolver delegates to `requireOrRefuse(spec, 'tracker_mode', SENTINEL)`.",
].join("\n");

const VACUOUS_SKILL_NO_REQUIRES_INPUT = [
  "# Generic skill",
  "",
  "This skill has no per-step refusal contract; the protocol probe ignores it.",
].join("\n");

describe("AC-STE-232.5 — requires_input_sentinel_coverage probe", () => {
  test("compliant SKILL.md (helper call + protocol citation) ⇒ zero violations", async () => {
    const fx = makeFixture({
      pluginSkills: [{ name: "setup", content: COMPLIANT_SETUP_SKILL }],
    });
    try {
      const r = await runRequiresInputSentinelCoverageProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("missing helper call ⇒ violation surfaced naming the helper", async () => {
    const fx = makeFixture({
      pluginSkills: [{ name: "setup", content: NONCOMPLIANT_NO_HELPER }],
    });
    try {
      const r = await runRequiresInputSentinelCoverageProbe(fx.root);
      expect(r.violations.length).toBeGreaterThan(0);
      const v = r.violations[0]!;
      expect(v.severity).toBe("error");
      expect(v.note).toMatch(/plugins\/dev-process-toolkit\/skills\/setup\/SKILL\.md/);
      expect(v.note).toContain("requireOrRefuse");
    } finally {
      fx.cleanup();
    }
  });

  test("missing protocol citation ⇒ violation surfaced naming the doc path", async () => {
    const fx = makeFixture({
      pluginSkills: [
        { name: "setup", content: NONCOMPLIANT_NO_PROTOCOL_CITATION },
      ],
    });
    try {
      const r = await runRequiresInputSentinelCoverageProbe(fx.root);
      expect(r.violations.length).toBeGreaterThan(0);
      const v = r.violations[0]!;
      expect(v.note).toContain("docs/auto-mode-protocol.md");
    } finally {
      fx.cleanup();
    }
  });

  test("skill without requires-input annotation ⇒ vacuous (no violation)", async () => {
    const fx = makeFixture({
      pluginSkills: [
        { name: "noop", content: VACUOUS_SKILL_NO_REQUIRES_INPUT },
      ],
    });
    try {
      const r = await runRequiresInputSentinelCoverageProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("project-skill (.claude/skills/) is also scanned (glob covers both surfaces)", async () => {
    const fx = makeFixture({
      projectSkills: [
        { name: "smoke-test", content: NONCOMPLIANT_NO_HELPER },
      ],
    });
    try {
      const r = await runRequiresInputSentinelCoverageProbe(fx.root);
      expect(r.violations.length).toBeGreaterThan(0);
      expect(r.violations[0]!.note).toMatch(
        /\.claude\/skills\/smoke-test\/SKILL\.md/,
      );
    } finally {
      fx.cleanup();
    }
  });

  test("violation message follows NFR-10 canonical shape", async () => {
    const fx = makeFixture({
      pluginSkills: [{ name: "setup", content: NONCOMPLIANT_NO_HELPER }],
    });
    try {
      const r = await runRequiresInputSentinelCoverageProbe(fx.root);
      expect(r.violations.length).toBeGreaterThan(0);
      const v = r.violations[0]!;
      expect(v.message).toContain("requires_input_sentinel_coverage");
      expect(v.message).toMatch(/Remedy:/);
      expect(v.message).toMatch(/Context:/);
    } finally {
      fx.cleanup();
    }
  });

  test("vacuous when no SKILL.md files exist ⇒ zero violations", async () => {
    const fx = makeFixture({});
    try {
      const r = await runRequiresInputSentinelCoverageProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("commented-out requires-input annotation in HTML comment ⇒ ignored", async () => {
    // Detection scope is non-comment body content. A skill that documents
    // the convention in an HTML comment without actually carrying the
    // annotation should not be flagged.
    const content = [
      "# Skill",
      "",
      "<!-- some skills carry: requires-input: <reason> -->",
      "Body content with no live annotation.",
    ].join("\n");
    const fx = makeFixture({
      pluginSkills: [{ name: "doc-only", content }],
    });
    try {
      const r = await runRequiresInputSentinelCoverageProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("both checks fail ⇒ separate violations recorded for traceability", async () => {
    const content = [
      "# Setup",
      "",
      "`requires-input: tracker mode is a workspace-wide decision.`",
      "",
      "Body with no helper call and no protocol citation.",
    ].join("\n");
    const fx = makeFixture({
      pluginSkills: [{ name: "setup", content }],
    });
    try {
      const r = await runRequiresInputSentinelCoverageProbe(fx.root);
      expect(r.violations.length).toBe(2);
      const helperViolation = r.violations.find((v) =>
        v.note.includes("requireOrRefuse"),
      );
      const protocolViolation = r.violations.find((v) =>
        v.note.includes("auto-mode-protocol.md"),
      );
      expect(helperViolation).toBeDefined();
      expect(protocolViolation).toBeDefined();
    } finally {
      fx.cleanup();
    }
  });
});
