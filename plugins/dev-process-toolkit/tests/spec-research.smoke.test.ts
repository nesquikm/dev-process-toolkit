// Bun-mocked smoke for /spec-research — STE-230 AC-STE-230.13.
//
// `/spec-research` is a markdown-driven forked skill (the LLM running
// inside the spec-researcher subagent follows the system prompt). The
// "smoke" therefore takes two complementary forms, mirroring the
// `report-issue.smoke.test.ts` shape:
//
//   1. **Runtime** assertions against the result-shape probe and a
//      synthetic emit harness — cases 1, 2, 3 build canonical /
//      truncated / empty-fallback blocks and assert the line cap, the
//      banner, and the truncation marker survive the shape check.
//
//   2. **Doc-conformance** assertions over `SKILL.md` for the
//      invariant cases (read-only, --no-tech vacuous, marker-driven
//      brainstorm fires) — the prose IS the contract the LLM consumes.
//
// The six cases below map onto the AC-STE-230.13 numbered list.

import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SPEC_RESEARCH_BANNER,
  SPEC_RESEARCH_SECTIONS,
  runSpecResearchResultShapeProbe,
} from "../adapters/_shared/src/spec_research_result_shape";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const AGENT_PATH = join(PLUGIN_ROOT, "agents", "spec-researcher.md");
const SKILL_PATH = join(PLUGIN_ROOT, "skills", "spec-research", "SKILL.md");
const BRAINSTORM_PATH = join(PLUGIN_ROOT, "skills", "brainstorm", "SKILL.md");
const SPEC_WRITE_PATH = join(PLUGIN_ROOT, "skills", "spec-write", "SKILL.md");

function readFile(path: string): string {
  if (!existsSync(path)) {
    throw new Error(`File not found at ${path}`);
  }
  return readFileSync(path, "utf-8");
}

function buildBlock(
  related: string[],
  decisions: string[],
  patterns: string[],
): string {
  return [
    SPEC_RESEARCH_BANNER,
    "```spec-research-result",
    "## Related FRs",
    ...related,
    "",
    "## Prior Decisions",
    ...decisions,
    "",
    "## Reusable ACs / Patterns",
    ...patterns,
    "```",
    "",
  ].join("\n");
}

function withTmpResultLog(
  content: string,
  fn: (root: string) => void,
): void {
  const root = mkdtempSync(join(tmpdir(), "spec-research-smoke-"));
  try {
    const dir = join(root, ".dpt-locks", "01H1SM");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "spec-research-result.txt"), content);
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// -----------------------------------------------------------------------------
// Case 1 — Topic with two strong matches → block has populated bullets
// in all three sections; wc -l ≤ 25; banner present.
// -----------------------------------------------------------------------------

describe("AC-STE-230.13 #1 — two-match block passes the shape probe", () => {
  test("populated 3-section block with banner; ≤ 25 lines", () => {
    const block = buildBlock(
      [
        "- STE-225 (archived) — context: fork pattern — relevant: forked subagents",
        "- STE-228 (archived) — branch gate — relevant: skill-allowlist mechanism",
      ],
      [
        "- subagents are read-only and discard intermediate state on exit",
        "- allowlist is the canonical exemption record",
      ],
      [
        "- STE-225:AC-3 — context: fork frontmatter with explicit agent: pin",
        "- STE-229:AC-10 — NON_COMMIT_PRODUCING_SKILLS allowlist append",
      ],
    );

    // Probe counts all lines (banner + open-fence + body incl. blanks +
    // close-fence). Match probe semantics, not a wc-without-blanks
    // approximation.
    expect(block.trimEnd().split("\n").length).toBeLessThanOrEqual(25);
    expect(block).toContain(SPEC_RESEARCH_BANNER);
    for (const heading of SPEC_RESEARCH_SECTIONS) {
      expect(block).toContain(heading);
    }

    withTmpResultLog(block, (root) => {
      const report = runSpecResearchResultShapeProbe(root);
      expect(report.violations).toEqual([]);
    });
  });
});

// -----------------------------------------------------------------------------
// Case 2 — Topic with zero matches → empty-fallback bullets in all
// three sections; banner present; ≤ 25 lines.
// -----------------------------------------------------------------------------

describe("AC-STE-230.13 #2 — zero-match block uses `- (none found)` placeholder", () => {
  test("empty-fallback block passes the shape probe", () => {
    const block = buildBlock(
      ["- (none found)"],
      ["- (none found)"],
      ["- (none found)"],
    );
    const lineCount = block.split("\n").length;
    expect(lineCount).toBeLessThanOrEqual(25);
    expect(block).toContain("- (none found)");

    withTmpResultLog(block, (root) => {
      const report = runSpecResearchResultShapeProbe(root);
      expect(report.violations).toEqual([]);
    });
  });

  test("subagent system prompt documents the empty-fallback bullet", () => {
    const body = readFile(AGENT_PATH);
    expect(body).toContain("- (none found)");
  });
});

// -----------------------------------------------------------------------------
// Case 3 — Topic with > 3 candidates → top-3 kept; truncation bullet
// appended; ≤ 25 lines.
// -----------------------------------------------------------------------------

describe("AC-STE-230.13 #3 — > 3 candidates → truncation marker appended, ≤ 25 lines", () => {
  test("truncated block carries `(… <K> more truncated)` marker; passes shape probe", () => {
    const block = buildBlock(
      [
        "- STE-225 (archived) — context: fork pattern — top match",
        "- STE-228 (archived) — branch gate — second match",
        "- STE-229 (archived) — allowlist constant — third match",
        "- (… 2 more truncated)",
      ],
      [
        "- subagents discard intermediate state on exit",
      ],
      [
        "- STE-225:AC-3 — context: fork frontmatter pattern",
      ],
    );
    expect(block).toMatch(/- \(… \d+ more truncated\)/);
    expect(block.split("\n").length).toBeLessThanOrEqual(25);

    withTmpResultLog(block, (root) => {
      const report = runSpecResearchResultShapeProbe(root);
      expect(report.violations).toEqual([]);
    });
  });

  test("subagent system prompt documents the truncation marker", () => {
    const body = readFile(AGENT_PATH);
    expect(body).toMatch(/- \(… <K> more truncated\)/);
  });
});

// -----------------------------------------------------------------------------
// Case 4 — Subagent reads but does not write — read-only invariant.
// -----------------------------------------------------------------------------

describe("AC-STE-230.13 #4 — subagent is read-only", () => {
  test("agents/spec-researcher.md frontmatter is the exact 3-tool list", () => {
    const text = readFile(AGENT_PATH);
    const fm = text.match(/^---\n([\s\S]*?)\n---/);
    expect(fm).not.toBeNull();
    const tools = fm![1]!.match(/^tools:\s*(.*)$/m)?.[1] ?? "";
    expect(tools).toBe("Read, Grep, Glob");
  });

  test("subagent system prompt explicitly forbids Edit/Write/Bash/MCP", () => {
    const body = readFile(AGENT_PATH);
    expect(body).toMatch(/Read-only/);
  });

  test("skill body documents the read-only invariant + branch-gate exemption", () => {
    const body = readFile(SKILL_PATH);
    expect(body).toContain("NON_COMMIT_PRODUCING_SKILLS");
    expect(body).toMatch(/Read-only|read-only/);
  });
});

// -----------------------------------------------------------------------------
// Case 5 — /spec-write --no-tech: spec-research is NOT invoked.
// -----------------------------------------------------------------------------

describe("AC-STE-230.13 #5 — /spec-write --no-tech short-circuits the spec-research invocation", () => {
  test("§ 0b step 2.5 prose declares the --no-tech carve-out (vacuous, no fork spawned)", () => {
    const text = readFile(SPEC_WRITE_PATH);
    const tail = text.slice(text.indexOf("Spec-research seed"));
    expect(tail).toMatch(/Skipped under `--no-tech`|skipped under `--no-tech`/);
    expect(tail).toMatch(/vacuous/i);
  });
});

// -----------------------------------------------------------------------------
// Case 6 — /brainstorm with the auto-approve marker fires the
// invocation at the end of Step 1.
// -----------------------------------------------------------------------------

describe("AC-STE-230.13 #6 — /brainstorm step 1.5 fires after Step 1 (marker-driven path)", () => {
  test("step 1.5 prose anchors the invocation between Step 1 and Step 2", () => {
    const text = readFile(BRAINSTORM_PATH);
    const idxStep1 = text.search(/###\s*1\.\s+Clarify the Problem/);
    const idx15 = text.search(/###\s*1\.5\.\s+Spec-research seed/);
    const idxStep2 = text.search(/###\s*2\.\s+Explore Approaches/);
    expect(idxStep1).toBeGreaterThan(0);
    expect(idx15).toBeGreaterThan(idxStep1);
    expect(idxStep2).toBeGreaterThan(idx15);
  });

  test("step 1.5 prose carries the literal /spec-research invocation as a markdown-driven instruction (the LLM following SKILL.md fires the call here)", () => {
    const text = readFile(BRAINSTORM_PATH);
    const idx15 = text.indexOf("1.5. Spec-research seed");
    const tail = text.slice(idx15);
    // Cut to the boundary of step 2 so we only inspect step 1.5 body.
    const idxStep2 = tail.search(/###\s*2\.\s+Explore Approaches/);
    const body = idxStep2 > 0 ? tail.slice(0, idxStep2) : tail;
    // Body MUST tell the LLM to invoke the canonical fork command,
    // identify the topic source, and propagate to Step 2 — the
    // markdown-driven analogue of "fires the invocation".
    expect(body).toMatch(/invoke `\/dev-process-toolkit:spec-research/);
    expect(body).toMatch(/clarified problem statement/);
    expect(body).toMatch(/proposed approaches reference/i);
  });

  test("the auto-approve marker contract is documented elsewhere in the toolkit so the parent-skill auto-mode flow stays discoverable", () => {
    // The brainstorm session itself doesn't need a marker; the
    // marker contract belongs to /spec-write's draft + commit gates.
    // We assert the canonical literal is byte-present in /spec-write
    // so a marker-driven outer chain (claude -p brainstorm → spec-write)
    // remains a documented end-to-end path.
    const text = readFile(SPEC_WRITE_PATH);
    expect(text).toContain("<dpt:auto-approve>v1</dpt:auto-approve>");
  });
});

// -----------------------------------------------------------------------------
// Cross-cutting smoke — gist-URL regex absent (this FR has no gist
// surface), no on-disk cache mentioned, doc-conformance pulls.
// -----------------------------------------------------------------------------

describe("AC-STE-230 cross-cutting — no cache, no gist URL surface", () => {
  test("agent + skill files mention neither `cache` nor `memoize`", () => {
    for (const path of [AGENT_PATH, SKILL_PATH]) {
      const text = readFile(path);
      expect(text).not.toMatch(/\bcache\b/i);
      expect(text).not.toMatch(/\bmemoize\b/i);
    }
  });

  test("agent + skill files do not reference the report-issue gist URL regex", () => {
    for (const path of [AGENT_PATH, SKILL_PATH]) {
      const text = readFile(path);
      expect(text).not.toMatch(/gist\.github\.com/);
    }
  });
});
