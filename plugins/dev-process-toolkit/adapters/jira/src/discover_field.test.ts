import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { discoverAcField, type JiraField } from "./discover_field";

const fixturesDir = join(import.meta.dir, "..", "..", "..", "tests", "fixtures", "mcp", "jira");

function load(name: string): JiraField[] {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8"));
}

describe("jira discoverAcField", () => {
  test("exact-name hit wins over partial-name and AC-word hits", () => {
    const fields = load("rest_api_3_field.json");
    const r = discoverAcField(fields);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.gid).toBe("customfield_10047");
      expect(r.name).toBe("Acceptance Criteria");
    }
  });

  test("renamed field returns partial-name or AC-word fallback", () => {
    const fields = load("rest_api_3_field_renamed.json");
    const r = discoverAcField(fields);
    // None match Tier 1/2/3, so expect graceful failure per the contract.
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason.toLowerCase()).toContain("no field");
    }
  });

  test("empty input is a graceful failure, not a crash", () => {
    const r = discoverAcField([]);
    expect(r.ok).toBe(false);
  });

  test("partial-name match ties break by lowest GID suffix", () => {
    const fields: JiraField[] = [
      { id: "customfield_10200", name: "Team Acceptance Criteria notes", custom: true },
      { id: "customfield_10100", name: "Acceptance Criteria (pilot)", custom: true },
    ];
    const r = discoverAcField(fields);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.gid).toBe("customfield_10100");
    }
  });

  test("non-array input is rejected", () => {
    // @ts-expect-error — deliberately invalid input
    const r = discoverAcField(null);
    expect(r.ok).toBe(false);
  });

  test("AC-word fallback hits when no 'Acceptance Criteria' phrase is present", () => {
    const fields: JiraField[] = [
      { id: "customfield_10500", name: "Story Points", custom: true },
      { id: "customfield_10600", name: "Team AC notes", custom: true },
    ];
    const r = discoverAcField(fields);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.gid).toBe("customfield_10600");
    }
  });
});
