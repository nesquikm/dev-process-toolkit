// STE-303 AC-STE-303.1 + AC-STE-303.11 — byte-shape tests for
// /setup SKILL.md (Step Nb prose + capability-key literals) and the mirror
// rows in /spec-write SKILL.md § 7 static plain-language map.
//
// The skill bodies are LLM prompts: the byte-checkable literals are the only
// regression signals once the run is non-interactive. Mirror the pattern of
// `tests/setup-bootstrap-commit-subject.test.ts` and the STE-238 prose tests.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pluginRoot = join(import.meta.dir, "..");
const setupSkillPath = join(pluginRoot, "skills", "setup", "SKILL.md");
const specWriteSkillPath = join(pluginRoot, "skills", "spec-write", "SKILL.md");

const CAPABILITY_KEYS = [
  "tracker_config_write_succeeded",
  "tracker_config_write_cancelled",
  "tracker_config_unchanged",
  "tracker_config_write_skipped_adapter_limit",
  "tracker_config_write_mcp_unavailable",
] as const;

function read(path: string): string {
  return readFileSync(path, "utf8");
}

// ---------------------------------------------------------------------------
// AC-STE-303.1 — /setup SKILL.md Step Nb (tracker-config write)
// ---------------------------------------------------------------------------

describe("AC-STE-303.1 — /setup SKILL.md declares a tracker-config write step", () => {
  test("skill body carries a `tracker-config write` (or equivalent) step heading", () => {
    const body = read(setupSkillPath);
    // The FR labels the new step "Step Nb — tracker-config write". The exact
    // step number is bikeshed; the byte signal is the phrase `tracker-config write`
    // as a section heading.
    expect(body).toMatch(/^###\s+\d+[a-z]?\.\s+.*[Tt]racker[- ]config write/m);
  });

  test("step prose names readTrackerConfig + writeTrackerConfig (STE-302 loader)", () => {
    const body = read(setupSkillPath);
    expect(body).toContain("writeTrackerConfig");
    expect(body).toContain("readTrackerConfig");
  });

  test("step prose names the active-adapter status fetch (list_project_statuses capability)", () => {
    const body = read(setupSkillPath);
    expect(body).toContain("list_project_statuses");
  });

  test("step prose names the four canonical roles", () => {
    const body = read(setupSkillPath);
    // Anchored within the tracker-config write step region — extract the
    // section bytes and assert against them so we don't false-match on
    // unrelated occurrences elsewhere in the skill.
    const m = body.match(
      /###\s+\d+[a-z]?\.\s+[^\n]*[Tt]racker[- ]config write[\s\S]*?(?=\n###\s+\d|\Z)/,
    );
    expect(m).not.toBeNull();
    const section = m![0];
    expect(section).toMatch(/\binitial\b/);
    expect(section).toMatch(/\bin_progress\b/);
    expect(section).toMatch(/\bin_review\b/);
    expect(section).toMatch(/\bdone\b/);
  });

  test("step prose names the approve / edit / cancel routing via AskUserQuestion", () => {
    const body = read(setupSkillPath);
    expect(body).toContain("AskUserQuestion");
    // The three branches MUST appear together near the tracker-config write step.
    expect(body).toMatch(/approve.*edit.*cancel|approve\s*\/\s*edit\s*\/\s*cancel/);
  });

  test("step prose declares mode: none vacuous (skipped)", () => {
    const body = read(setupSkillPath);
    const m = body.match(
      /###\s+\d+[a-z]?\.\s+[^\n]*[Tt]racker[- ]config write[\s\S]*?(?=\n###\s+\d|\Z)/,
    );
    expect(m).not.toBeNull();
    const section = m![0];
    expect(section).toMatch(/mode:?\s*none|mode\s*=\s*none/);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-303.11 — five capability keys exist as MUST-emit directives in /setup
// ---------------------------------------------------------------------------

describe("AC-STE-303.11 — /setup SKILL.md emits the 5 capability keys as literal tokens", () => {
  test.each(CAPABILITY_KEYS.map((k) => [k]))(
    "/setup SKILL.md carries a MUST-emit directive for `%s`",
    (key) => {
      const body = read(setupSkillPath);
      // Pattern mirror of STE-238's closing_summary_capability_keys probe:
      // `MUST emit \`<key>\`` (literal backticked token).
      const re = new RegExp(`MUST emit \`${key}\``);
      expect(body).toMatch(re);
    },
  );
});

// ---------------------------------------------------------------------------
// AC-STE-303.11 — /spec-write SKILL.md § 7 plain-language map mirrors the keys
// ---------------------------------------------------------------------------

describe("AC-STE-303.11 — /spec-write § 7 static map carries plain-language rows for the 5 keys", () => {
  test.each(CAPABILITY_KEYS.map((k) => [k]))(
    "/spec-write SKILL.md § 7 carries a row for `%s` in the capability-key table",
    (key) => {
      const body = read(specWriteSkillPath);
      // Each capability-key table row is `| \`<key>\` | <prose> |` (or grouped
      // with siblings via ` / `). Assert the literal backticked key appears in
      // a table row line.
      const tableStart = body.search(/\| Capability key \| Rendered prose \|/);
      expect(tableStart).toBeGreaterThan(-1);
      const tail = body.slice(tableStart);
      const tableEndRel = tail.search(/\nAdd new keys to this map/);
      expect(tableEndRel).toBeGreaterThan(-1);
      const tableRegion = body.slice(tableStart, tableStart + tableEndRel);
      // The key must appear inside the table region.
      expect(tableRegion).toContain(`\`${key}\``);
    },
  );
});
