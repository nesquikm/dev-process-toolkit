// STE-719 (M_d1b4b7) AC.12 — report schema v1, session aliasing and severity.
//
// `session_aliases.ts` is the one aliaser: `createAliasMap()`,
// `aliasFor(map, sessionId)` (s1, s2, ... in first-appearance order),
// `sessionDigest(sessionId)` (first 16 hex of sha256 of the raw id) and
// `seedAliasMap(map, sessions)` (re-seeds from a report's `sessions[]`, so one
// session keeps one alias in every report file). `retro_report.ts` builds the
// `dpt-retro/1` report with `buildRetroReport({ scope, sessionIds, results,
// pluginVersion, generatedAt })` and validates one with `parseRetroReport(text)`.

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { RULE_IDS, SKIPPED, SRC, UUID_RE, aliasMod, reportMod, sid } from "./_m_d1b4b7_retro_fixture";

function result(id: string, disposition: string): Record<string, unknown> {
  return {
    id,
    source: ["timeline"],
    threshold: 1,
    unit: "runs",
    value: disposition === SKIPPED ? null : 3,
    disposition,
    reason: disposition === SKIPPED ? "no timeline file" : null,
  };
}

function results(tripped: number): Record<string, unknown>[] {
  return RULE_IDS.map((id, i) => result(id, i < tripped ? "tripped" : i === 3 ? SKIPPED : "clear"));
}

async function build(o: { tripped?: number; sessionIds?: string[]; scope?: { kind: string; id: string | null } } = {}): Promise<any> {
  const { buildRetroReport } = await reportMod();
  return buildRetroReport({
    scope: o.scope ?? { kind: "fr", id: "STE-1" },
    sessionIds: o.sessionIds ?? [sid(3), sid(1), sid(3)],
    results: results(o.tripped ?? 0),
    pluginVersion: "9.9.9",
    generatedAt: "2026-11-06T12:00:00.000Z",
  });
}

describe("AC-STE-719.12 session_aliases", () => {
  test("aliasFor numbers sessions s1, s2, ... in first-appearance order and is stable per id", async () => {
    const { createAliasMap, aliasFor } = await aliasMod();
    const m = createAliasMap();
    expect([aliasFor(m, sid(5)), aliasFor(m, sid(2)), aliasFor(m, sid(5)), aliasFor(m, sid(9))]).toEqual(["s1", "s2", "s1", "s3"]);
  });

  test("sessionDigest is the first 16 hex of the sha256 of the raw id", async () => {
    const { sessionDigest } = await aliasMod();
    const want = createHash("sha256").update(sid(4)).digest("hex").slice(0, 16);
    expect(sessionDigest(sid(4))).toBe(want);
    expect(sessionDigest(sid(4))).toMatch(/^[0-9a-f]{16}$/);
  });

  test("seedAliasMap re-seeds from a report's sessions: a seeded id keeps its alias, a new id takes the next number", async () => {
    const { createAliasMap, aliasFor, seedAliasMap, sessionDigest } = await aliasMod();
    const m = createAliasMap();
    seedAliasMap(m, [
      { alias: "s1", digest: sessionDigest(sid(11)) },
      { alias: "s2", digest: sessionDigest(sid(12)) },
    ]);
    expect(aliasFor(m, sid(12))).toBe("s2");
    expect(aliasFor(m, sid(13))).toBe("s3");
    expect(aliasFor(m, sid(11))).toBe("s1");
  });
});

describe("AC-STE-719.12 buildRetroReport", () => {
  test("the report carries the v1 schema keys", async () => {
    const r = await build();
    expect(Object.keys(r).sort()).toEqual(
      ["generated_at", "plugin_version", "rules", "schema", "scope", "sessions", "suggested_severity", "tripped_count"].sort(),
    );
    expect(r.schema).toBe("dpt-retro/1");
    expect(r.plugin_version).toBe("9.9.9");
    expect(r.generated_at).toBe("2026-11-06T12:00:00.000Z");
    expect(r.scope).toEqual({ kind: "fr", id: "STE-1" });
    for (const rule of r.rules) expect(Object.keys(rule).sort()).toEqual(["disposition", "id", "reason", "source", "threshold", "unit", "value"]);
  });

  test("sessions are aliases in first-appearance order, each with its sessionDigest; no raw id survives", async () => {
    const { sessionDigest } = await aliasMod();
    const r = await build();
    expect(r.sessions).toEqual([
      { alias: "s1", digest: sessionDigest(sid(3)) },
      { alias: "s2", digest: sessionDigest(sid(1)) },
    ]);
    const text = JSON.stringify(r);
    expect([...text.matchAll(UUID_RE)].map((m) => m[0])).toEqual([]);
  });

  test("a session scope's id is held as an alias, never the raw id", async () => {
    const r = await build({ scope: { kind: "session", id: sid(3) }, sessionIds: [sid(3)] });
    expect(JSON.stringify(r)).not.toContain(sid(3));
    expect([...JSON.stringify(r).matchAll(UUID_RE)]).toEqual([]);
  });

  test("tripped_count counts tripped rules; suggested_severity is low for one, medium for two or more, never high", async () => {
    const zero = await build({ tripped: 0 });
    const one = await build({ tripped: 1 });
    const two = await build({ tripped: 2 });
    const three = await build({ tripped: 3 });
    expect([zero.tripped_count, one.tripped_count, two.tripped_count, three.tripped_count]).toEqual([0, 1, 2, 3]);
    expect(one.suggested_severity).toBe("low");
    expect(two.suggested_severity).toBe("medium");
    expect(three.suggested_severity).toBe("medium");
    for (const r of [zero, one, two, three]) expect(r.suggested_severity).not.toBe("high");
  });
});

describe("AC-STE-719.12 parseRetroReport", () => {
  test("accepts a built report", async () => {
    const { parseRetroReport } = await reportMod();
    const r = await build({ tripped: 2 });
    expect(parseRetroReport(JSON.stringify(r))).toEqual(r);
  });

  test("rejects a wrong schema, a `high` severity, a raw session id and an unknown disposition", async () => {
    const { parseRetroReport } = await reportMod();
    const good = await build({ tripped: 1 });
    const bad = [
      { ...good, schema: "dpt-retro/2" },
      { ...good, suggested_severity: "high" },
      { ...good, sessions: [{ alias: sid(1), digest: good.sessions[0].digest }] },
      { ...good, rules: good.rules.map((x: any, i: number) => (i === 0 ? { ...x, disposition: "skipped" } : x)) },
    ];
    for (const b of bad) expect(() => parseRetroReport(JSON.stringify(b))).toThrow();
  });
});

describe("AC-STE-719.12 one aliaser: source scan", () => {
  test("retro_report.ts imports aliasFor from ./session_aliases", () => {
    const text = readFileSync(join(SRC, "retro_report.ts"), "utf-8");
    expect(text).toMatch(/import\s*\{[^}]*\baliasFor\b[^}]*\}\s*from\s*["']\.\/session_aliases(?:\.ts)?["']/);
  });

  test("no module under adapters/_shared/src other than session_aliases.ts holds the template text `s${", () => {
    const needle = "`s${";
    const holders = readdirSync(SRC)
      .filter((f) => f.endsWith(".ts"))
      .filter((f) => f !== "session_aliases.ts")
      .filter((f) => readFileSync(join(SRC, f), "utf-8").includes(needle));
    expect(holders).toEqual([]);
  });
});
