// STE-375 (M101) — Jira Epic milestone binding: capability-key registration
// + adapter-doc conformance.
//
// The Epic-absent fallback (AC-STE-375.4) surfaces a NEW informational
// capability row, `milestone_epic_unsupported`. The capability-keys probe
// (`closing_summary_capability_keys`, /gate-check) is BIDIRECTIONAL —
// const ⇄ SKILL directive (M97 `milestone_attach_failed` precedent) — so the
// key must land on BOTH sides in the same change:
//
//   1. `CANONICAL_CAPABILITY_KEYS` in
//      adapters/_shared/src/closing_summary_capability_keys.ts registers the
//      key (routed to spec-write via KEY_OWNER_SKILL);
//   2. skills/spec-write/SKILL.md § 7 carries the literal
//      `MUST emit \`milestone_epic_unsupported\`` directive plus a
//      static-map table row for the key.
//
// And `adapters/jira.md` must document the epic binding (Schema M
// frontmatter — pinned by tests/adapter-schema-jira-project-milestone.test.ts
// — plus the § Project Milestone prose checked here): the
// `issuetype = Epic` listing JQL, the `parent`-based membership, the
// `getJiraProjectIssueTypesMetadata` Epic-absent probe, and the
// `milestone_epic_unsupported` fallback row.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CANONICAL_CAPABILITY_KEYS } from "../adapters/_shared/src/closing_summary_capability_keys";

const pluginRoot = join(import.meta.dir, "..");
const specWriteSkillPath = join(pluginRoot, "skills", "spec-write", "SKILL.md");
const jiraPath = join(pluginRoot, "adapters", "jira.md");

const KEY = "milestone_epic_unsupported";

describe("AC-STE-375.4 — milestone_epic_unsupported capability-key registration", () => {
  test("CANONICAL_CAPABILITY_KEYS registers milestone_epic_unsupported", () => {
    expect(CANONICAL_CAPABILITY_KEYS as readonly string[]).toContain(KEY);
  });

  test("spec-write SKILL.md carries the literal MUST-emit directive for the key", () => {
    const body = readFileSync(specWriteSkillPath, "utf8");
    // Same directive shape the bidirectional probe greps for: literal
    // `MUST emit \`<key>\`` with the backticked token — narrative prose
    // is insufficient (STE-220 lesson).
    expect(body).toMatch(new RegExp(`MUST emit\\s*\`${KEY}\``));
  });

  test("spec-write SKILL.md § 7 static map carries a table row for the key", () => {
    const body = readFileSync(specWriteSkillPath, "utf8");
    // The static plain-language map is a markdown table; the key must
    // appear backticked on a table row (`| ... \`<key>\` ... |`), like the
    // M97 milestone_attach_failed row.
    const rows = body
      .split("\n")
      .filter((line) => line.trimStart().startsWith("|") && line.includes(`\`${KEY}\``));
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});

describe("STE-375 — adapters/jira.md documents the epic milestone binding", () => {
  const body = readFileSync(jiraPath, "utf8");

  test("documents the issuetype = Epic listing enumeration (no full labelled-task scan to list)", () => {
    // AC-STE-375.3: listing milestones enumerates a handful of Epics via
    // JQL, not every labelled issue.
    expect(body).toContain("issuetype = Epic");
  });

  test("documents parent-based membership for the epic binding", () => {
    // AC-STE-375.1: the FR Task binds to the Epic via the native `parent`
    // field (editJiraIssue additional_fields.parent).
    expect(body).toMatch(/additional_fields.*parent|parent.*additional_fields/s);
    expect(body).toMatch(/parent = <epic-key>|parent\s*=\s*<epic-key>|`parent`/);
  });

  test("documents the Epic-absent fallback probe (getJiraProjectIssueTypesMetadata)", () => {
    // AC-STE-375.4: the fallback trigger is the project's issue-type
    // metadata lacking Epic (or parent being unsettable).
    expect(body).toContain("getJiraProjectIssueTypesMetadata");
  });

  test("documents the milestone_epic_unsupported fallback capability row", () => {
    expect(body).toContain(KEY);
  });
});
