import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Probe-parity gate (M12 follow-up).
//
// The Schema L probe is defined once in docs/patterns.md but inlined verbatim
// at the top of every mode-aware skill. If a future edit "improves" the probe
// in one skill but forgets the others, the Pattern 9 byte-identical guarantee
// drifts silently — the synthetic baseline fixture will keep passing because
// it doesn't actually invoke the skills. This test locks parity at the source.

const pluginRoot = join(import.meta.dir, "..");
const skillsDir = join(pluginRoot, "skills");

// All 7 skills carry the Schema L probe reference.
const MODE_AWARE_SKILLS = [
  "setup",
  "spec-write",
  "implement",
  "gate-check",
  "pr",
  "spec-review",
  "spec-archive",
] as const;

// 6 of the 7 use the no-op guard sentence (mode-none branch is a literal
// fall-through to pre-M12 body). `setup` is the outlier — its probe routes
// between fresh-setup and `--migrate` rather than gating tracker behavior.
const NOOP_GUARD_SKILLS = MODE_AWARE_SKILLS.filter((s) => s !== "setup");

const SCHEMA_L_REFERENCE = "Schema L probe (see `docs/patterns.md` § Tracker Mode Probe)";
const NOOP_GUARD = "If `CLAUDE.md` has no `## Task Tracking` section, mode is `none`";

function readSkill(name: string): string {
  return readFileSync(join(skillsDir, name, "SKILL.md"), "utf8");
}

describe("Schema L probe parity across mode-aware skills", () => {
  for (const skill of MODE_AWARE_SKILLS) {
    test(`${skill}: references the canonical Schema L probe`, () => {
      const body = readSkill(skill);
      expect(body).toContain(SCHEMA_L_REFERENCE);
    });
  }

  for (const skill of NOOP_GUARD_SKILLS) {
    test(`${skill}: carries the mode-none no-op guard sentence`, () => {
      const body = readSkill(skill);
      expect(body).toContain(NOOP_GUARD);
    });
  }

  test("the canonical probe definition still lives in docs/patterns.md", () => {
    const patterns = readFileSync(join(pluginRoot, "docs", "patterns.md"), "utf8");
    expect(patterns).toMatch(/^### Pattern: Tracker Mode Probe \(Schema L\)$/m);
  });

  test("each skill announces a `Tracker mode probe` step heading", () => {
    // Cheap structural check: every mode-aware skill exposes a probe section,
    // either as a numbered step (`0. **Tracker mode probe**`) or a top-level
    // section (`## Tracker Mode Probe` / `### 0. Tracker mode probe`). Catches
    // the "deleted the heading but left the prose" failure mode.
    for (const skill of MODE_AWARE_SKILLS) {
      const body = readSkill(skill);
      expect(body).toMatch(/Tracker [Mm]ode [Pp]robe/);
    }
  });
});

// Template + fresh-setup fixture probe-safety (AC-29.6, AC-29.7).
//
// The Schema L probe is `grep -c '^## Task Tracking$'`. A literal heading
// inside a trailing HTML comment cannot be distinguished by that regex,
// so the template MUST NOT contain the heading at all — even in comments.
// The canonical mode-none `/setup` output is equally bound: absence of
// the heading ≡ mode: none (AC-29.5).

function countProbeAnchorHits(body: string): number {
  // Replicates `grep -c '^## Task Tracking$'` exactly: only lines whose
  // entire content is "## Task Tracking". No trailing spaces, no indent.
  let n = 0;
  for (const line of body.split("\n")) {
    if (line === "## Task Tracking") n++;
  }
  return n;
}

describe("Schema L probe anchor absence (AC-29.6, AC-29.7)", () => {
  test("templates/CLAUDE.md.template contains no `^## Task Tracking$` line (AC-29.6)", () => {
    const body = readFileSync(join(pluginRoot, "templates", "CLAUDE.md.template"), "utf8");
    expect(countProbeAnchorHits(body)).toBe(0);
  });

  test("mode-none-fresh-setup fixture contains no `^## Task Tracking$` line (AC-29.7)", () => {
    const body = readFileSync(
      join(pluginRoot, "tests", "fixtures", "projects", "mode-none-fresh-setup", "CLAUDE.md"),
      "utf8",
    );
    expect(countProbeAnchorHits(body)).toBe(0);
  });
});
