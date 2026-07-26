import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  findRequiresInputDeclarationLine,
  isRequiresInputDeclaration,
  runRequiresInputSentinelCoverageProbe,
} from "../adapters/_shared/src/requires_input_sentinel_coverage";

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

// ---------------------------------------------------------------------------
// Declaration-vs-mention recognizer — the fix for the /upgrade false positive
// ---------------------------------------------------------------------------
//
// Scope is decided PER OCCURRENCE, not per file. Before this, any body
// containing the literal token was pulled in, so a skill that merely repeated
// the protocol doc's own disclaimer ("the marker is read but never relaxes a
// `requires-input:` gate") was required to cite a helper it had no gate for.
// The naive fix — strip inline-code spans — is a trap: every real annotation
// in /setup is itself backtick-wrapped, so stripping them blinds the probe.

const REAL_DISCLAIMER =
  "This is the same principle by which the marker is read but never relaxes a " +
  "`requires-input:` gate. Declining drops that one entry from the batch.";

describe("isRequiresInputDeclaration — declarations (in scope)", () => {
  test.each([
    ["canonical standalone (the incident shape)", "`requires-input: tracker mode is a workspace-wide decision; no safe default exists.`"],
    ["bullet", "- `requires-input: the deploy target has no safe default.`"],
    ["star bullet", "* `requires-input: no safe default.`"],
    ["ordered", "1. `requires-input: no safe default.`"],
    ["ordered paren", "1) `requires-input: no safe default.`"],
    ["bold bare label (the Phase 0 shape)", "**`requires-input:` Phase 0 acceptance — the gate carries the contract.**"],
    ["italic label", "*`requires-input: no safe default.`*"],
    ["ATX heading with reason", "### `requires-input: region has no safe default.`"],
    ["ATX heading bare", "#### `requires-input:` deploy acceptance"],
    ["blockquote", "> `requires-input: no safe default.`"],
    ["blockquote + bullet + bold nested", "> - **`requires-input: no safe default.`**"],
    ["indented", "    `requires-input: no safe default.`"],
    ["un-backticked line-leading", "requires-input: no safe default exists."],
    ["un-backticked bulleted", "- requires-input: no safe default exists."],
    ["table cell leading, with reason", "| `requires-input: no safe default.` | refuses |"],
    ["table cell leading, bare", "| `requires-input:` | Phase 0 |"],
    ["mid-line WITH a reason", "Step 4 uses `requires-input: no safe default exists` and refuses."],
    ["mid-line reason containing a colon", "See step 9 (`requires-input: mode: none is not safe`) which refuses."],
    ["template placeholder kept, bulleted", "- `requires-input: <reason>` — refuses to proceed without an answer."],
    ["template placeholder kept, mid-line", "Step 4 carries `requires-input: <reason>` and refuses."],
    ["reason after the closing backtick", "`requires-input:` no safe default exists."],
  ])("declares: %s", (_name, line) => {
    expect(isRequiresInputDeclaration(line as string)).toBe(true);
  });
});

describe("isRequiresInputDeclaration — prose mentions (out of scope)", () => {
  test.each([
    ["the real /upgrade disclaimer", REAL_DISCLAIMER],
    ["its /setup twin", "it is read but never relaxes `requires-input:` — see `docs/auto-mode-protocol.md` § The Rule."],
    ["the probe catalogue's own sentence", "For every skill body carrying a non-comment `requires-input:` annotation, asserts (a) a helper reference."],
    ["copy-edit: does not loosen", "The marker does not loosen a `requires-input:` gate."],
    ["copy-edit: never weakens", "The marker never weakens a `requires-input:` gate."],
    ["copy-edit: hedged", "Note that, in every case, the marker never relaxes a `requires-input:` gate."],
    ["copy-edit: bulleted prose", "- The marker is read but never relaxes a `requires-input:` gate."],
    ["copy-edit: bold lead-in", "**Important.** The marker never relaxes a `requires-input:` gate."],
    ["copy-edit: numbered prose", "3. The marker never relaxes a `requires-input:` gate."],
    ["copy-edit: passive", "A `requires-input:` gate is never relaxed by the marker."],
    ["copy-edit: de-backticked", "The marker is read but never relaxes a requires-input: gate."],
    ["table cell, mid-cell mention", "| /upgrade | mentions the `requires-input:` contract |"],
    ["no token at all", "This skill has no per-step refusal contract."],
  ])("mentions: %s", (_name, line) => {
    expect(isRequiresInputDeclaration(line as string)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The incident this probe exists for MUST still fire (recall preserved)
// ---------------------------------------------------------------------------

const GATE_SHAPES: [string, string][] = [
  ["standalone", "`requires-input: no safe default exists.`"],
  ["bullet", "- `requires-input: no safe default exists.`"],
  ["bold bare label", "**`requires-input:` Phase 0 acceptance.**"],
  ["un-backticked", "requires-input: no safe default exists."],
  ["blockquote", "> `requires-input: no safe default exists.`"],
  ["ATX heading", "### `requires-input: no safe default exists.`"],
  ["table cell", "| `requires-input: no safe default.` | refuses |"],
  ["mid-line with reason", "Step 4 uses `requires-input: no safe default exists` here."],
  ["template placeholder", "- `requires-input: <reason>` — refuses to proceed."],
];

describe("negative control — a genuine gate missing the helper still hard-fails", () => {
  test.each(GATE_SHAPES)("neither citation ⇒ 2 violations: %s", async (_n, gate) => {
    const fx = makeFixture({
      pluginSkills: [{ name: "deploy", content: ["# Deploy", "", gate, "", "No helper, no doc."].join("\n") }],
    });
    try {
      expect((await runRequiresInputSentinelCoverageProbe(fx.root)).violations.length).toBe(2);
    } finally {
      fx.cleanup();
    }
  });

  test.each(GATE_SHAPES)("doc cited but helper missing ⇒ 1 violation naming the helper: %s", async (_n, gate) => {
    const fx = makeFixture({
      pluginSkills: [{ name: "deploy", content: ["# Deploy", "", gate, "", "See `docs/auto-mode-protocol.md`."].join("\n") }],
    });
    try {
      const r = await runRequiresInputSentinelCoverageProbe(fx.root);
      expect(r.violations.length).toBe(1);
      expect(r.violations[0]!.note).toContain("requireOrRefuse");
    } finally {
      fx.cleanup();
    }
  });
});

describe("the red-on-main case — prose alone never scopes a skill in", () => {
  test.each([
    ["verbatim", REAL_DISCLAIMER],
    ["reworded", "The marker does not loosen a `requires-input:` gate."],
    ["passive", "A `requires-input:` gate is never relaxed by the marker."],
    ["blockquoted", "> The marker never relaxes a `requires-input:` gate."],
    ["emphasised", "*The marker never relaxes a `requires-input:` gate.*"],
  ])("%s ⇒ vacuous, despite citing neither token", async (_n, prose) => {
    const fx = makeFixture({
      pluginSkills: [{ name: "upgrade", content: ["# Upgrade", "", prose as string].join("\n") }],
    });
    try {
      expect((await runRequiresInputSentinelCoverageProbe(fx.root)).violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("a mention AND a real gate in one file ⇒ in scope, anchored at the gate", async () => {
    const fx = makeFixture({
      pluginSkills: [{
        name: "deploy",
        content: ["# Deploy", "", REAL_DISCLAIMER, "`requires-input: the deploy target has no safe default.`", "", "No helper cited."].join("\n"),
      }],
    });
    try {
      const r = await runRequiresInputSentinelCoverageProbe(fx.root);
      expect(r.violations.length).toBe(2);
      expect(r.violations[0]!.line).toBe(4);
    } finally {
      fx.cleanup();
    }
  });
});

describe("anchor selection", () => {
  test("prefers the first declaration carrying a concrete reason", async () => {
    const fx = makeFixture({
      pluginSkills: [{
        name: "setupish",
        content: ["# Setup", "", "- `requires-input: <reason>` — the convention this skill documents.", "", "`requires-input: tracker mode has no safe default.`", "", "No helper."].join("\n"),
      }],
    });
    try {
      expect((await runRequiresInputSentinelCoverageProbe(fx.root)).violations[0]!.line).toBe(5);
    } finally {
      fx.cleanup();
    }
  });

  test("falls back to the first declaration of any shape", async () => {
    const fx = makeFixture({
      pluginSkills: [{ name: "smokeish", content: ["# Smoke", "", "**`requires-input:` Phase 0 acceptance.**", "", "No helper."].join("\n") }],
    });
    try {
      expect((await runRequiresInputSentinelCoverageProbe(fx.root)).violations[0]!.line).toBe(3);
    } finally {
      fx.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Dogfood pins — the forcing function
// ---------------------------------------------------------------------------

describe("dogfood — this repo", () => {
  const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
  const skillBody = (rel: string): string => readFileSync(join(REPO_ROOT, rel), "utf-8");

  test("the in-scope set is exactly the two skills that really own a gate", () => {
    const found: string[] = [];
    for (const base of [
      join(REPO_ROOT, "plugins", "dev-process-toolkit", "skills"),
      join(REPO_ROOT, ".claude", "skills"),
    ]) {
      if (!existsSync(base)) continue;
      for (const dir of readdirSync(base)) {
        const p = join(base, dir, "SKILL.md");
        if (!existsSync(p)) continue;
        if (findRequiresInputDeclarationLine(readFileSync(p, "utf-8")) !== null) {
          found.push(relative(REPO_ROOT, p));
        }
      }
    }
    // A change here means a real gate was reformatted out of recognizable
    // shape — a SILENT de-scope this pin converts into a red test.
    expect(found.sort()).toEqual([
      join(".claude", "skills", "smoke-test", "SKILL.md"),
      join("plugins", "dev-process-toolkit", "skills", "setup", "SKILL.md"),
    ]);
  });

  test("the probe is green against this repo", async () => {
    expect((await runRequiresInputSentinelCoverageProbe(REPO_ROOT)).violations).toEqual([]);
  });

  test("/upgrade carries the literal token and is STILL out of scope", () => {
    const body = skillBody(join("plugins", "dev-process-toolkit", "skills", "upgrade", "SKILL.md"));
    // The `contains` half is load-bearing: without it this pin would pass
    // vacuously if someone simply deleted the sentence.
    expect(body).toContain("requires-input:");
    expect(findRequiresInputDeclarationLine(body)).toBeNull();
  });

  test("the probe catalogue does not scope /gate-check into its own probe", () => {
    const body = skillBody(join("plugins", "dev-process-toolkit", "skills", "gate-check", "SKILL.md"));
    expect(body).toContain("requires-input:");
    expect(findRequiresInputDeclarationLine(body)).toBeNull();
  });
});

describe("recognizer is cheap on hostile input", () => {
  test("a pathological leading decoration run stays fast (bounded peel)", () => {
    const line = "|".repeat(100_000) + " `requires-input: x`";
    const t0 = performance.now();
    isRequiresInputDeclaration(line);
    expect(performance.now() - t0).toBeLessThan(25);
  });

  test("the cap does not change any realistic verdict", () => {
    expect(isRequiresInputDeclaration("> - **`requires-input: no safe default.`**")).toBe(true);
    expect(isRequiresInputDeclaration("   > *  `requires-input: no safe default.`")).toBe(true);
  });
});
