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

  // M_b054b1 (AC-STE-869.1) — create-metadata rows carry `fieldId`, never `id`
  // (recorded 2026-11-24 on the live v2 server; invented names and numbers here).
  const META = [
    { fieldId: "summary", name: "Summary", required: true, schema: { type: "string" } },
    { fieldId: "customfield_10050", name: "Acceptance Criteria", required: false, schema: { type: "string" }, allowedValues: [] },
  ];
  test("a create-metadata row is read by its fieldId", () => {
    expect(discoverAcField(META)).toEqual({ ok: true, gid: "customfield_10050", name: "Acceptance Criteria" });
  });
  for (const [title, answer] of [
    ["the rows", META],
    ["a v1 answer", { fields: META, maxResults: 50, startAt: 0, total: 2 }],
    ["a v2 answer", { data: { fields: META, maxResults: 50, startAt: 0, total: 2 } }],
    ["an array of pages", [{ data: { fields: META.slice(0, 1), maxResults: 1, startAt: 0, total: 2 } }, { data: { fields: META.slice(1), maxResults: 1, startAt: 1, total: 2 } }]],
  ] as Array<[string, unknown]>) {
    test(`stdin {fields: ${title}} finds the field`, () => {
      const r = Bun.spawnSync(["bun", "run", join(import.meta.dir, "discover_field.ts")], { stdin: Buffer.from(JSON.stringify({ fields: answer })) });
      expect(JSON.parse(r.stdout.toString())).toEqual({ ok: true, gid: "customfield_10050", name: "Acceptance Criteria" });
    });
  }
  for (const [title, answer] of [
    ["an in-band error", { data: { error: "x", status: 404, fields: META } }],
    ["a flagged error", { error: true, message: "x", statusCode: 404 }],
    ["a partial page", { data: { fields: META.slice(0, 1), maxResults: 1, startAt: 0, total: 2 } }],
    ["a page repeated in place of the next", [{ fields: META.slice(0, 1), startAt: 0, total: 2 }, { fields: META.slice(0, 1), startAt: 0, total: 2 }]],
    ["pages whose totals disagree", [{ fields: META.slice(0, 1), startAt: 0, total: 5 }, { fields: META.slice(1), startAt: 1, total: 2 }]],
    ["an only page that starts late", { fields: META, startAt: 2, total: 4 }],
    ["a v2 page with no total", { data: { fields: META, maxResults: 2, startAt: 0 } }],
    ["content blocks", [{ type: "text", text: JSON.stringify({ fields: META }) }]],
    ["a string", JSON.stringify({ fields: META })],
    ["nothing", undefined],
    ["null", null],
    ["a key beside data", { data: { fields: META }, meta: {} }],
  ] as Array<[string, unknown]>) {
    test(`stdin {fields: ${title}} is no discovery: it exits non-zero, never {ok: false}`, () => {
      const r = Bun.spawnSync(["bun", "run", join(import.meta.dir, "discover_field.ts")], { stdin: Buffer.from(JSON.stringify({ fields: answer })) });
      expect(r.exitCode).toBe(1);
      expect(r.stdout.toString()).toBe("");
    });
  }
});
