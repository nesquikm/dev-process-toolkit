// STE-872 (M_e8850b) — the Jira create-metadata fixtures match the recorded
// requests and answers on both surfaces (AC-STE-872.4 / .5).
//
// v2: getJiraIssueTypeMetaWithFields.v2.json gains the request fields the
// documented AC-field read sends (requiredFieldsOnly, startAt).
// v1: getJiraIssueTypeMetaWithFields.json is new — ONE page of a longer
// listing (startAt 0, maxResults 5, total 17), plain JSON, rows with `key`
// AND `fieldId` and no `id`. `discover_field.ts` reads it through its stdin
// front door: the lone page is refused (it is not whole), a whole chain built
// from it plus invented further pages is accepted. Invented values only.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const JIRA = join(PLUGIN_ROOT, "tests", "fixtures", "live-shapes", "jira");
const DISCOVER = join(PLUGIN_ROOT, "adapters", "jira", "src", "discover_field.ts");

type Obj = Record<string, any>;
const load = (f: string): Obj => JSON.parse(readFileSync(join(JIRA, f), "utf-8")) as Obj;
const V1 = "getJiraIssueTypeMetaWithFields.json";
const V2 = "getJiraIssueTypeMetaWithFields.v2.json";

function discover(fields: unknown): { exitCode: number | null; signal: string | null; stdout: string; stderr: string } {
  const p = Bun.spawnSync([process.execPath, "run", DISCOVER], { stdin: new TextEncoder().encode(JSON.stringify({ fields })), stdout: "pipe", stderr: "pipe" });
  return { exitCode: p.exitCode, signal: p.signalCode ?? null, stdout: p.stdout.toString(), stderr: p.stderr.toString() };
}
const show = (r: ReturnType<typeof discover>): string => `exit=${r.exitCode} signal=${r.signal}\nstdout=${r.stdout}\nstderr=${r.stderr}`;

/** An invented v1 row in the recorded shape: `key` and `fieldId`, no `id`. */
const row = (n: number, name: string): Obj => ({
  required: false,
  schema: { type: "string", custom: "com.atlassian.jira.plugin.system.customfieldtypes:textarea", customId: n },
  name,
  key: `customfield_${n}`,
  hasDefaultValue: false,
  operations: ["set"],
  fieldId: `customfield_${n}`,
});
/** The recorded first page plus invented pages 2..4, 17 rows in all, the AC field on page 3. */
function wholeChain(): Obj[] {
  const first = load(V1).answer as Obj;
  const names = Array.from({ length: 12 }, (_, i) => (i === 6 ? "Acceptance Criteria" : `Zz Field ${i + 1}`));
  const rows = names.map((name, i) => row(10100 + i, name));
  const page = (startAt: number, fields: Obj[]): Obj => ({ startAt, maxResults: 5, total: 17, fields });
  return [first, page(5, rows.slice(0, 5)), page(10, rows.slice(5, 10)), page(15, rows.slice(10))];
}

describe("AC-STE-872.4 — the v2 create-metadata fixture holds the request the AC-field read sends", () => {
  test("AC-STE-872.4: v2 request inputs carry requiredFieldsOnly: false and startAt: 0", () => {
    expect(load(V2).provenance.request.inputs).toMatchObject({ requiredFieldsOnly: false, startAt: 0 });
  });
  test("AC-STE-872.4: v2 keeps its recorded date and method", () => {
    expect({ measured_at: load(V2).provenance.measured_at, method: load(V2).provenance.method }).toEqual({ measured_at: "2026-11-24", method: "read-only-call" });
  });
  test("AC-STE-872.4: the documented AC-field read names the same two request fields", () => {
    const doc = readFileSync(join(PLUGIN_ROOT, "docs", "setup-tracker-mode.md"), "utf-8");
    expect(doc).toContain("requiredFieldsOnly");
    expect(doc).toContain("startAt");
  });
});

describe("AC-STE-872.5 — the v1 create-metadata answer is a sanitised fixture with its request", () => {
  test("AC-STE-872.5: provenance — a dated read-only call whose request holds requiredFieldsOnly, startAt and maxResults", () => {
    const p = load(V1).provenance;
    expect(p.method).toBe("read-only-call");
    expect(p.measured_at).toBe("2026-11-25");
    expect(p.request).toMatchObject({ name: "getJiraIssueTypeMetaWithFields", inputs: { projectIdOrKey: "ZZ", requiredFieldsOnly: false, startAt: 0, maxResults: 5 } });
    expect(String(p.note)).toContain("every value is invented");
  });
  test("AC-STE-872.5: the answer is one page of a longer listing in the recorded envelope", () => {
    const a = load(V1).answer;
    expect(Object.keys(a).sort()).toEqual(["fields", "maxResults", "startAt", "total"]);
    expect({ startAt: a.startAt, maxResults: a.maxResults, total: a.total, rows: a.fields.length }).toEqual({ startAt: 0, maxResults: 5, total: 17, rows: 5 });
  });
  test("AC-STE-872.5: every row has key AND fieldId, and no id", () => {
    const rows = load(V1).answer.fields as Obj[];
    expect(rows.map((r) => [typeof r.key, typeof r.fieldId, "id" in r])).toEqual(rows.map(() => ["string", "string", false]));
  });
  test("AC-STE-872.5: no real key, site, address or account id", () => {
    const text = readFileSync(join(JIRA, V1), "utf-8");
    expect([...text.matchAll(/\b[A-Z][A-Z0-9]+-\d+\b/g)].map((m) => m[0]).filter((k) => !/^ZZ-\d+$/.test(k))).toEqual([]);
    expect([...text.matchAll(/https?:\/\/([^/"\s]+)/g)].map((m) => m[1])).toEqual(["example.invalid"]);
    expect(text).not.toMatch(/atlassian\.net|api\.atlassian\.com|@|accountId|displayName|emailAddress|avatar/i);
    expect([...text.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g)].map((m) => m[0]).filter((u) => !u.startsWith("aaaaaaaa-aaaa-4aaa-8aaa-"))).toEqual([]);
  });

  test("AC-STE-872.5: discover_field.ts refuses the lone recorded page — it is not the whole listing", () => {
    const r = discover(load(V1).answer);
    expect(r.exitCode, show(r)).toBe(1);
    expect(r.stdout, show(r)).toBe("");
    expect(r.stderr, show(r)).toMatch(/5 of 17/);
  });
  test("AC-STE-872.5: discover_field.ts accepts the whole chain built from the recorded page and finds the AC field", () => {
    const r = discover(wholeChain());
    expect(r.exitCode, show(r)).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ ok: true, gid: "customfield_10106", name: "Acceptance Criteria" });
  });
  test("AC-STE-872.5: discover_field.ts refuses the chain with its last page missing", () => {
    const r = discover(wholeChain().slice(0, 3));
    expect(r.exitCode, show(r)).toBe(1);
    expect(r.stderr, show(r)).toMatch(/15 of 17/);
  });
  test("AC-STE-872.5: discover_field.ts refuses the chain with a page out of order", () => {
    const c = wholeChain();
    const r = discover([c[0], c[2], c[1], c[3]]);
    expect(r.exitCode, show(r)).toBe(1);
    expect(r.stdout, show(r)).toBe("");
  });
});
