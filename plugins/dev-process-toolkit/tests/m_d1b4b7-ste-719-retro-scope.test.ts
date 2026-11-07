// STE-719 (M_d1b4b7) AC.10 — `resolveRetroScope(projectRoot, arg)`.
//
// The one scope resolver /retro and STE-722 share. It returns
// `{ kind, id, sessions, reason }`: `kind` is "session" (no argument), "fr" or
// "milestone"; `sessions` the raw scope session ids (aliased only when a report
// is written); `reason` null, or why the set is empty. Free text is refused in
// the NFR-10 shape (verdict, `Remedy:`, `Context:`). One test per case, plus the
// front door writing an empty scope's reason onto every rule.

import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ALL_ON,
  RULE_IDS,
  SKIPPED,
  cleanupTemps,
  makeConfigDir,
  makeRetroTree,
  reportFiles,
  retroDir,
  runRetro,
  scopeMod,
  sid,
  tokenRow,
  writeFr,
  writeTokenLedger,
} from "./_m_d1b4b7_retro_fixture";

afterAll(cleanupTemps);

async function withEnv<T>(env: Record<string, string>, cwd: string, fn: () => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k];
    process.env[k] = env[k];
  }
  const savedCwd = process.cwd();
  process.chdir(cwd);
  try {
    return await fn();
  } finally {
    process.chdir(savedCwd);
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** A tree whose token ledger claims sessions 01..03 to three FRs of two milestones. */
function claimedTree(label: string, tracking = ALL_ON): string {
  const root = makeRetroTree(label, { tracking });
  writeFr(root, "frs/STE-1.md", "STE-1", "M_abc123");
  writeFr(root, "frs/archive/STE-2.md", "STE-2", "M_abc123");
  writeFr(root, "frs/STE-3.md", "STE-3", "M_other9");
  writeTokenLedger(root, [
    tokenRow(sid(1), 10, { claimed_by: "STE-1" }),
    tokenRow(sid(1), 10, { claimed_by: "STE-1", skill: "tdd" }),
    tokenRow(sid(2), 10, { claimed_by: "STE-2" }),
    tokenRow(sid(3), 10, { claimed_by: "STE-3" }),
    tokenRow(sid(4), 10),
  ]);
  return root;
}

describe("AC-STE-719.10 resolveRetroScope", () => {
  test("no argument selects the current session (findCurrentSession: the newest transcript of this cwd)", async () => {
    const { resolveRetroScope } = await scopeMod();
    const root = makeRetroTree("scope-none");
    const config = makeConfigDir("scope-none-config", root, [sid(7), sid(8)]);
    const scope = await withEnv({ CLAUDE_CONFIG_DIR: config }, root, async () => resolveRetroScope(root, undefined));
    expect(scope.kind).toBe("session");
    expect(scope.sessions).toEqual([sid(8)]);
    expect(scope.reason).toBeNull();
  });

  test("an FR id selects exactly the sessions with token-ledger rows claimed by it", async () => {
    const { resolveRetroScope } = await scopeMod();
    const root = claimedTree("scope-fr");
    const scope = await resolveRetroScope(root, "STE-1");
    expect([scope.kind, scope.id]).toEqual(["fr", "STE-1"]);
    expect(scope.sessions).toEqual([sid(1)]);
    expect(scope.reason).toBeNull();
  });

  test("a milestone selects the sessions claimed by any of its FRs, active or archived", async () => {
    const { resolveRetroScope } = await scopeMod();
    const root = claimedTree("scope-ms");
    const scope = await resolveRetroScope(root, "M_abc123");
    expect([scope.kind, scope.id]).toEqual(["milestone", "M_abc123"]);
    expect([...scope.sessions].sort()).toEqual([sid(1), sid(2)]);
    expect(scope.reason).toBeNull();
  });

  test("free text is refused in the NFR-10 shape", async () => {
    const { resolveRetroScope } = await scopeMod();
    const root = claimedTree("scope-free");
    let err: unknown = null;
    try {
      await resolveRetroScope(root, "make the gates faster please");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    const msg = (err as Error).message;
    expect(msg).toMatch(/\nRemedy: /);
    expect(msg).toMatch(/\nContext: /);
  });

  test("an FR no row claims resolves to no session, reason `scope resolves to no session`", async () => {
    const { resolveRetroScope } = await scopeMod();
    const root = claimedTree("scope-empty");
    const scope = await resolveRetroScope(root, "STE-99");
    expect(scope.sessions).toEqual([]);
    expect(scope.reason).toBe("scope resolves to no session");
  });

  test("with tracking.token_stats off an FR scope resolves to no session, suffixed `(tracking.token_stats off)`", async () => {
    const { resolveRetroScope } = await scopeMod();
    const root = claimedTree("scope-ts-off", { ...ALL_ON, token_stats: false });
    const scope = await resolveRetroScope(root, "STE-1");
    expect(scope.sessions).toEqual([]);
    expect(scope.reason).toBe("scope resolves to no session (tracking.token_stats off)");
  });

  test("with tracking.token_stats off a milestone scope also resolves to no session with the suffix", async () => {
    const { resolveRetroScope } = await scopeMod();
    const root = claimedTree("scope-ts-off-ms", { ...ALL_ON, token_stats: false });
    const scope = await resolveRetroScope(root, "M_abc123");
    expect(scope.sessions).toEqual([]);
    expect(scope.reason).toBe("scope resolves to no session (tracking.token_stats off)");
  });
});

describe("AC-STE-719.10 an empty scope skips every rule with the scope's reason", () => {
  for (const [label, tracking, reason] of [
    ["fr-empty", ALL_ON, "scope resolves to no session"],
    ["fr-ts-off", { ...ALL_ON, token_stats: false }, "scope resolves to no session (tracking.token_stats off)"],
  ] as const) {
    test(`front door, ${label}: every rule reads skipped with reason "${reason}"`, () => {
      const root = claimedTree(`door-${label}`, tracking);
      const r = runRetro(root, [label === "fr-empty" ? "STE-99" : "STE-1"]);
      expect(r.status).toBe(0);
      const files = reportFiles(root);
      expect(files.length).toBe(1);
      const report = JSON.parse(readFileSync(join(retroDir(root), files[0]!), "utf-8"));
      expect(report.sessions).toEqual([]);
      expect(report.rules.map((x: any) => x.id)).toEqual([...RULE_IDS]);
      for (const rule of report.rules) expect({ id: rule.id, d: rule.disposition, reason: rule.reason }).toEqual({ id: rule.id, d: SKIPPED, reason });
    });
  }
});
