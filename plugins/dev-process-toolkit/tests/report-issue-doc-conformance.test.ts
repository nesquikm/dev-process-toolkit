// Doc-conformance for /report-issue — STE-229 cross-cutting AC coverage.
//
// Asserts shape contracts that the LLM consumes when running the skill:
//   - SKILL.md frontmatter shape (AC-STE-229.1)
//   - Four Socratic prompts in canonical order (AC-STE-229.5)
//   - Branch-gate-exemption note present (AC-STE-229.10)
//   - Three new capability rows in /spec-write § 7 (AC-STE-229.11)
//   - Gist-URL regex documented in /brainstorm SKILL.md (AC-STE-229.13)

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { specWriteStep7Map } from "./_skill-md";

const pluginRoot = join(import.meta.dir, "..");

function readSkill(name: string): string {
  return readFileSync(join(pluginRoot, "skills", name, "SKILL.md"), "utf-8");
}

// -----------------------------------------------------------------------------
// AC-STE-229.1 — SKILL.md frontmatter shape.
// -----------------------------------------------------------------------------

describe("AC-STE-229.1 — /report-issue SKILL.md frontmatter shape", () => {
  test("name: report-issue", () => {
    const body = readSkill("report-issue");
    const m = body.match(/^name:\s*report-issue\s*$/m);
    expect(m).not.toBeNull();
  });

  test("description is a single-line non-empty string", () => {
    const body = readSkill("report-issue");
    const m = body.match(/^description:\s*(.+)$/m);
    expect(m).not.toBeNull();
    expect(m![1]!.trim().length).toBeGreaterThan(0);
  });

  test("argument-hint is exactly '[--full]'", () => {
    const body = readSkill("report-issue");
    const m = body.match(/^argument-hint:\s*['"](.+?)['"]\s*$/m);
    expect(m).not.toBeNull();
    expect(m![1]).toBe("[--full]");
  });
});

// -----------------------------------------------------------------------------
// AC-STE-229.5 — four Socratic prompts in canonical order.
// -----------------------------------------------------------------------------

describe("AC-STE-229.5 — four Socratic prompts in canonical order", () => {
  const prompts = [
    "What happened? (one or two sentences describing the unexpected behaviour)",
    "What did you expect to happen instead?",
    "Severity? (low / medium / high)",
    "Reproducible? If so, list the steps. If not, type 'unsure'.",
  ];

  test("each prompt is present verbatim in SKILL.md", () => {
    const body = readSkill("report-issue");
    for (const p of prompts) {
      expect(body).toContain(p);
    }
  });

  test("the four prompts appear in canonical document order", () => {
    const body = readSkill("report-issue");
    let last = -1;
    for (const p of prompts) {
      const idx = body.indexOf(p);
      expect(idx).toBeGreaterThan(last);
      last = idx;
    }
  });
});

// -----------------------------------------------------------------------------
// AC-STE-229.10 — branch-gate-exemption note documented.
// -----------------------------------------------------------------------------

describe("AC-STE-229.10 — branch-gate-exemption note", () => {
  test("SKILL.md documents the exemption via NON_COMMIT_PRODUCING_SKILLS allowlist", () => {
    const body = readSkill("report-issue");
    expect(body).toContain("NON_COMMIT_PRODUCING_SKILLS");
    // The prose must name the probe being exempted.
    expect(body).toContain("commit_producing_skill_branch_gate");
    // And cite STE-228 (the probe owner).
    expect(body).toContain("STE-228");
  });

  test("SKILL.md states the skill writes nothing under VCS / never invokes git commit", () => {
    const body = readSkill("report-issue");
    expect(body).toMatch(/write[s]?\s+nothing\s+under\s+VCS|writes\s+no\s+files\s+under\s+VCS/i);
    expect(body).toMatch(/never\s+invoke[s]?\s+`?git commit`?/i);
  });
});

// -----------------------------------------------------------------------------
// AC-STE-229.11 — three new capability rows in /spec-write § 7.
// -----------------------------------------------------------------------------

describe("AC-STE-229.11 — capability rows in /spec-write § 7", () => {
  const rows = [
    {
      key: "report_issue_default_applied",
      prose:
        "/report-issue gist auto-pushed (marker present in prompt body) — verify the gist contents before sharing",
    },
    {
      key: "report_issue_declined",
      prose: "/report-issue gist declined — temp directory deleted, no upload",
    },
    {
      key: "report_issue_redacted_payload",
      prose:
        "/report-issue scrubbed <N> secret-pattern match(es) before upload — see metadata.json for breakdown",
    },
  ];

  test("each capability key appears in the spec-write § 7 plain-language map", () => {
    const body = readSkill("spec-write");
    const map = specWriteStep7Map(body);
    for (const r of rows) {
      expect(map).toContain(`\`${r.key}\``);
    }
  });

  test("each row's rendered prose appears verbatim in the map", () => {
    const body = readSkill("spec-write");
    const map = specWriteStep7Map(body);
    for (const r of rows) {
      expect(map).toContain(r.prose);
    }
  });
});

// -----------------------------------------------------------------------------
// AC-STE-229.13 — gist-URL regex documented in /brainstorm SKILL.md.
// -----------------------------------------------------------------------------

describe("AC-STE-229.13 — /brainstorm gist-URL seed step", () => {
  test("/brainstorm SKILL.md cites the canonical gist-URL regex", () => {
    const body = readSkill("brainstorm");
    expect(body).toContain(
      "^https://gist\\.github\\.com/[^/]+/[a-f0-9]{8,}/?$",
    );
  });

  test("/brainstorm SKILL.md documents the gh gist view fetch step before Step 1 (Clarify)", () => {
    const body = readSkill("brainstorm");
    expect(body).toContain("gh gist view");
    const fetchIdx = body.indexOf("gh gist view");
    const step1Idx = body.indexOf("### 1. Clarify the Problem");
    expect(fetchIdx).toBeGreaterThan(-1);
    expect(step1Idx).toBeGreaterThan(-1);
    expect(fetchIdx).toBeLessThan(step1Idx);
  });

  test("/brainstorm argument-hint advertises the gist-URL form", () => {
    const body = readSkill("brainstorm");
    const m = body.match(/^argument-hint:\s*['"](.+?)['"]\s*$/m);
    expect(m).not.toBeNull();
    expect(m![1]).toContain("gist-url");
  });
});
