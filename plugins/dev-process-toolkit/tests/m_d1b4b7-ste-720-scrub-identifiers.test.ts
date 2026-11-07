// STE-720 (M_d1b4b7) AC.1 to AC.5 and AC.14 — the pure identifier pass
// `scrubIdentifiers(text, { home, branches, aliases })` and the no-settings-key
// guard.
//
// All ids are synthetic (AC-STE-720.10): user `fixture-user` (and the
// `fixture.user` / `fixtureuser` spellings AC.2 names), UUIDs
// `00000000-0000-4000-8000-00000000000N`, branches `feat/...-fixture`.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  BRANCH,
  DECORATION,
  DEFAULT_BRANCHES,
  IDENTIFIER_KEYS,
  PLUGIN_ROOT,
  REPO_ROOT,
  SCRUB_IDENTIFIERS,
  TRUNK_SHA,
  USER,
  V300_SHA,
  aliasMod,
  atRev,
  branchAlias,
  counts,
  idMod,
  predRemotePrefix,
  predSharedMap,
  predSlug,
  predUsersPrefix,
  predUuid,
  uuid,
} from "./_m_d1b4b7_ste720_fixture";

async function fresh(): Promise<() => any> {
  const { createAliasMap } = await aliasMod();
  return () => createAliasMap();
}

// ===========================================================================
// AC-STE-720.1 — IDENTIFIER_PATTERNS
// ===========================================================================

describe("AC-STE-720.1 IDENTIFIER_PATTERNS", () => {
  test("holds exactly home_path, session_id, branch_name, in that order", async () => {
    const { IDENTIFIER_PATTERNS } = await idMod();
    expect(IDENTIFIER_PATTERNS).toBeDefined();
    const keys = Array.isArray(IDENTIFIER_PATTERNS)
      ? IDENTIFIER_PATTERNS.map((p: any) => (typeof p === "string" ? p : p.key))
      : Object.keys(IDENTIFIER_PATTERNS);
    expect(keys).toEqual([...IDENTIFIER_KEYS]);
  });

  test("scrubIdentifiers returns the ScrubResult shape with all three rows, zero counts included", async () => {
    const { scrubIdentifiers } = await idMod();
    const make = await fresh();
    const r = scrubIdentifiers("nothing to see here", { branches: [], aliases: make() });
    expect(r).toEqual({
      scrubbed: "nothing to see here",
      matches: [
        { pattern: "home_path", count: 0 },
        { pattern: "session_id", count: 0 },
        { pattern: "branch_name", count: 0 },
      ],
    });
  });

  test("the module is pure: no node:fs, child_process or Bun.spawn in its source", () => {
    const src = readFileSync(SCRUB_IDENTIFIERS, "utf-8");
    expect(src).not.toMatch(/from\s+["']node:(?:fs|child_process)["']/);
    expect(src).not.toMatch(/Bun\.(?:spawn|\$|file|write)/);
  });
});

// ===========================================================================
// AC-STE-720.2 — home_path
// ===========================================================================

describe("AC-STE-720.2 home_path", () => {
  // Regression (STE-720 audit): a bare home path inside compact JSON must not swallow the next field.
  test("a bare /home/<user> inside JSON stops at the closing quote and keeps the next field", async () => {
    const { scrubIdentifiers } = await idMod();
    const make = await fresh();
    const line = `{"cwd":"/home/${USER}","gitBranch":"feat/x","n":1}`;
    const r = scrubIdentifiers(line, { branches: [], aliases: make() });
    expect(r.scrubbed).toBe(`{"cwd":"~","gitBranch":"feat/x","n":1}`);
    expect(JSON.parse(r.scrubbed)).toEqual({ cwd: "~", gitBranch: "feat/x", n: 1 });
  });

  test("/Users/fixture-user/repo/a.ts becomes ~/repo/a.ts with no home given, counted once", async () => {
    const { scrubIdentifiers } = await idMod();
    expect(predUsersPrefix(scrubIdentifiers, await fresh())).toBe(true);
  });

  test("/home/fixture-user/repo/a.ts becomes ~/repo/a.ts with no home given, counted once", async () => {
    const { scrubIdentifiers } = await idMod();
    const make = await fresh();
    const r = scrubIdentifiers(`/home/${USER}/repo/a.ts`, { branches: [], aliases: make() });
    expect(r.scrubbed).toBe("~/repo/a.ts");
    expect(counts(r.matches).home_path).toBe(1);
  });

  test("the literal ctx.home becomes ~ even outside /Users and /home", async () => {
    const { scrubIdentifiers } = await idMod();
    const make = await fresh();
    const r = scrubIdentifiers("see /opt/fixture-home/repo/a.ts", { home: "/opt/fixture-home", branches: [], aliases: make() });
    expect(r.scrubbed).toBe("see ~/repo/a.ts");
    expect(counts(r.matches).home_path).toBe(1);
  });

  test("only the prefix is rewritten: deeper path segments are kept", async () => {
    const { scrubIdentifiers } = await idMod();
    const make = await fresh();
    const r = scrubIdentifiers(`/Users/${USER}/x/y and /home/${USER}/p/q.ts`, { branches: [], aliases: make() });
    expect(r.scrubbed).toBe("~/x/y and ~/p/q.ts");
    expect(counts(r.matches).home_path).toBe(2);
  });

  test("with home /Users/fixture.user the project-folder slug -Users-fixture-user-repo becomes -~-repo; -home-fixtureuser-repo/ becomes -~-repo/ with no home", async () => {
    const { scrubIdentifiers } = await idMod();
    expect(predSlug(scrubIdentifiers, await fresh())).toBe(true);
  });

  test("a slug followed by / is rewritten too, and every rewrite counts under home_path", async () => {
    const { scrubIdentifiers } = await idMod();
    const make = await fresh();
    const r = scrubIdentifiers(`/Users/${USER}/a and -Users-fixtureuser/b and -home-fixtureuser-c`, { branches: [], aliases: make() });
    expect(r.scrubbed).toBe("~/a and -~/b and -~-c");
    expect(counts(r.matches)).toEqual({ home_path: 3, session_id: 0, branch_name: 0 });
  });
});

// ===========================================================================
// AC-STE-720.3 — session_id, one shared alias map
// ===========================================================================

describe("AC-STE-720.3 session_id", () => {
  test("two UUIDs across two files with one alias map become s1 and s2 in first-appearance order, the same alias in both files", async () => {
    const { scrubIdentifiers } = await idMod();
    expect(predSharedMap(scrubIdentifiers, await fresh())).toBe(true);
  });

  test("every occurrence is counted, and an uppercase UUID is aliased too", async () => {
    const { scrubIdentifiers } = await idMod();
    expect(predUuid(scrubIdentifiers, await fresh())).toBe(true);
    const make = await fresh();
    const r = scrubIdentifiers("X 00000000-0000-4000-8000-00000000000A Y", { branches: [], aliases: make() });
    expect(r.scrubbed).toBe("X s1 Y");
    expect(counts(r.matches).session_id).toBe(1);
  });

  test("the pass numbers through the passed map: a session already aliased keeps its alias, a new one takes the next number", async () => {
    const { scrubIdentifiers } = await idMod();
    const { createAliasMap, aliasFor } = await aliasMod();
    const aliases = createAliasMap();
    expect(aliasFor(aliases, uuid(9))).toBe("s1");
    const r = scrubIdentifiers(`${uuid(3)} ${uuid(9)}`, { branches: [], aliases });
    expect(r.scrubbed).toBe("s2 s1");
    expect(aliases.last).toBe(2);
  });

  test("source scan: scrub_identifiers.ts imports createAliasMap and aliasFor from session_aliases.ts", () => {
    const src = readFileSync(SCRUB_IDENTIFIERS, "utf-8");
    const imports = [...src.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["']\.\/session_aliases(?:\.ts)?["']/g)].map((m) => m[1]!);
    const names = imports.join(",").split(",").map((s) => s.trim().split(/\s+as\s+/)[0]!.trim());
    expect(names).toContain("createAliasMap");
    expect(names).toContain("aliasFor");
  });
});

// ===========================================================================
// AC-STE-720.4 — branch_name (pure half; the front-door sources are in
// m_d1b4b7-ste-720-branch-sources.test.ts)
// ===========================================================================

describe("AC-STE-720.4 branch_name", () => {
  test("feat/fixture-branch from ctx.branches becomes branch-<first 8 hex of its sha256>", async () => {
    const { scrubIdentifiers } = await idMod();
    const make = await fresh();
    const h = branchAlias(BRANCH);
    expect(h).toMatch(/^branch-[0-9a-f]{8}$/);
    const r = scrubIdentifiers(`on ${BRANCH} now`, { branches: [BRANCH], aliases: make() });
    expect(r.scrubbed).toBe(`on ${h} now`);
    expect(counts(r.matches).branch_name).toBe(1);
  });

  test("origin/feat/fixture-branch in a git log decoration becomes origin/branch-<8 hex>; HEAD, origin/main and main stay", async () => {
    const { scrubIdentifiers } = await idMod();
    expect(predRemotePrefix(scrubIdentifiers, await fresh())).toBe(true);
    void DECORATION;
  });

  test("main, master, develop, trunk and HEAD are never rewritten, even when listed in ctx.branches", async () => {
    const { scrubIdentifiers } = await idMod();
    const make = await fresh();
    const text = "on main, master, develop, trunk and HEAD; origin/main too";
    const r = scrubIdentifiers(text, { branches: [...DEFAULT_BRANCHES], aliases: make() });
    expect(r.scrubbed).toBe(text);
    expect(counts(r.matches).branch_name).toBe(0);
  });

  test("a word containing a branch name as a substring is left alone", async () => {
    const { scrubIdentifiers } = await idMod();
    const make = await fresh();
    const h = branchAlias("fix");
    const r = scrubIdentifiers(`prefix fixes fix and ${BRANCH}-old`, { branches: ["fix", BRANCH], aliases: make() });
    expect(r.scrubbed).toBe(`prefix fixes ${h} and ${BRANCH}-old`);
    expect(counts(r.matches).branch_name).toBe(1);
  });
});

// ===========================================================================
// AC-STE-720.5 — idempotence
// ===========================================================================

describe("AC-STE-720.5 idempotence", () => {
  test("a second pass over scrubbed output returns identical text and all-zero counts", async () => {
    const { scrubIdentifiers } = await idMod();
    const make = await fresh();
    const ctx = { home: "/Users/fixture.user", branches: [BRANCH, "fix"], aliases: make() };
    const text = [
      `/Users/${USER}/repo/a.ts`,
      `/home/${USER}/b`,
      "/Users/fixture.user/c",
      "~/.claude/projects/-Users-fixture-user-repo/x.jsonl",
      `-home-fixtureuser-repo/ ${uuid(1)} ${uuid(2)}`,
      DECORATION,
      "a fix in prefix",
    ].join("\n");
    const once = scrubIdentifiers(text, ctx);
    expect(once.scrubbed).not.toBe(text);
    const twice = scrubIdentifiers(once.scrubbed, ctx);
    expect(twice.scrubbed).toBe(once.scrubbed);
    expect(twice.matches).toEqual([
      { pattern: "home_path", count: 0 },
      { pattern: "session_id", count: 0 },
      { pattern: "branch_name", count: 0 },
    ]);
  });
});

// ===========================================================================
// AC-STE-720.14 — no settings key; the archived AC-STE-706.12 amendment
// ===========================================================================

const CLAUSE =
  "*(Amended by AC-STE-720.14 (v3.2.0): `report_issue.identifier_redaction` is dropped from the later `new` rows; identifier redaction is the per-run `--redact-identifiers` flag, not a settings key.)*";
const STE706 = "specs/frs/archive/STE-706.md";

describe("AC-STE-720.14 no settings key", () => {
  test("NEW_KEYS and every settingsKeyOrder path hold no report_issue key", async () => {
    const m = (await import("../adapters/_shared/src/project_settings")) as Record<string, any>;
    expect(m.NEW_KEYS.filter((k: string) => k.includes("report_issue"))).toEqual([]);
    const seen: string[] = [];
    const walk = (path: string): void => {
      for (const k of m.settingsKeyOrder(path) as string[]) {
        const child = path === "" ? k : `${path}.${k}`;
        seen.push(child);
        walk(child);
        walk(`${child}[]`);
      }
    };
    walk("");
    expect(seen.length).toBeGreaterThan(10);
    expect(seen.filter((p) => p.includes("report_issue"))).toEqual([]);
  });

  test("the AC-STE-706.12 MAPPING table names no report_issue path", () => {
    const src = readFileSync(join(PLUGIN_ROOT, "tests", "m_94e6f7-ste-706-settings-loader.test.ts"), "utf-8");
    const at = src.indexOf("const MAPPING: Record<string, Row> = {");
    expect(at).toBeGreaterThan(-1);
    const block = src.slice(at, src.indexOf("\n};", at));
    expect(block).not.toContain("report_issue");
  });

  test("docs/settings-reference.md names no report_issue key", () => {
    expect(readFileSync(join(PLUGIN_ROOT, "docs", "settings-reference.md"), "utf-8")).not.toContain("report_issue");
  });

  test("specs/frs/archive/STE-706.md differs from its v3.0.0 bytes only by the clause appended to the AC-STE-706.12 line", () => {
    const base = atRev(V300_SHA, STE706).split("\n");
    const now = readFileSync(join(REPO_ROOT, STE706), "utf-8").split("\n");
    expect(now.length).toBe(base.length);
    const changed = now.map((l, i) => [i, l, base[i]] as const).filter(([, l, b]) => l !== b);
    expect(changed.length).toBe(1);
    const [, line, old] = changed[0]!;
    expect(old!.startsWith("- AC-STE-706.12: ")).toBe(true);
    expect(old!.includes("`report_issue.identifier_redaction` (STE-720)")).toBe(true);
    expect(line).toBe(`${old} ${CLAUSE}`);
  });

  test("this FR's tree carries the STE-706 file byte-identical to trunk (no further edit)", () => {
    expect(readFileSync(join(REPO_ROOT, STE706), "utf-8")).toBe(atRev(TRUNK_SHA, STE706));
  });

  test("the M_d1b4b7 plan records the amendment", () => {
    // The plan moves to specs/plan/archive/ when the milestone archives; read it where it lives.
    const live = join(REPO_ROOT, "specs", "plan", "M_d1b4b7.md");
    const plan = existsSync(live) ? live : join(REPO_ROOT, "specs", "plan", "archive", "M_d1b4b7.md");
    expect(readFileSync(plan, "utf-8")).toContain("Amended by AC-STE-720.14");
  });
});
