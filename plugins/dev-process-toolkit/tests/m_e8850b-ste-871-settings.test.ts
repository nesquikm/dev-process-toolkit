// STE-871 (M_e8850b) — the declared Jira site: the two settings keys, the one
// comparison function and the documentation (AC-STE-871.1 / .2 / .5 / .9).
//
// Legacy home: `site:` / `cloud_id:` lines under `### Jira` in CLAUDE.md.
// Settings home: `task_tracking.jira` in specs/settings.yaml. Invented hosts
// and UUIDs only.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readWorkspaceBinding } from "../adapters/_shared/src/workspace_binding";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const HOST = "tracker.example.invalid";
const UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";
const OTHER_UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02";

type Obj = Record<string, unknown>;
type Adapter = "jira" | "linear";
type Pair = [key: string, value: unknown];

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function tempRoot(): string {
  const d = mkdtempSync(join(tmpdir(), "dpt-871-binding-"));
  dirs.push(d);
  return d;
}

/** A legacy tree; each pair is one written line, so a key may repeat. */
function legacy(adapter: Adapter, pairs: Pair[]): string {
  const root = tempRoot();
  const lines = ["# Fixture", "", "## Task Tracking", "", `mode: ${adapter}`, "", adapter === "jira" ? "### Jira" : "### Linear", "", ...(adapter === "linear" ? ["team: ZZT"] : []), "project: ZZ", ...pairs.map(([k, v]) => `${k}: ${String(v)}`), ""];
  writeFileSync(join(root, "CLAUDE.md"), lines.join("\n"));
  return root;
}
/** A settings-file tree. */
function settings(adapter: Adapter, pairs: Pair[]): string {
  const root = tempRoot();
  writeFileSync(join(root, "CLAUDE.md"), "# Fixture\n");
  mkdirSync(join(root, "specs"), { recursive: true });
  const binding: Obj = { ...(adapter === "linear" ? { team: "ZZT" } : {}), project: "ZZ", ...Object.fromEntries(pairs) };
  writeFileSync(join(root, "specs", "settings.yaml"), `schema_version: 1\nmin_dpt_version: 3.0.0\ntask_tracking: ${JSON.stringify({ mode: adapter, [adapter]: binding })}\n`);
  return root;
}
const HOMES: Array<[string, (a: Adapter, p: Pair[]) => string]> = [
  ["legacy", legacy],
  ["settings file", settings],
];
const read = (root: string, adapter: Adapter = "jira"): Obj => readWorkspaceBinding(join(root, "CLAUDE.md"), adapter) as unknown as Obj;

/** The message of the refusal `read` throws, which must be NFR-10 and name `key`. */
function refusal(root: string, key: string, adapter: Adapter = "jira"): void {
  let message = "";
  try {
    const b = read(root, adapter);
    message = `NOT REFUSED: ${JSON.stringify(b)}`;
  } catch (e) {
    message = (e as Error).message;
  }
  expect(message).not.toContain("NOT REFUSED");
  expect(message).toMatch(new RegExp(`(?<![\\w-])${key}(?![\\w-])`));
  const lines = message.split("\n");
  expect(lines.filter((l) => l.startsWith("Remedy: ")).length).toBe(1);
  expect(lines.filter((l) => l.startsWith("Context: ")).length).toBe(1);
  expect(lines[0]).not.toMatch(/^(Remedy|Context): /);
}

const BAD_SITES: unknown[] = [`https://${HOST}`, `${HOST}:8443`, `${HOST}/jira`, `user@${HOST}`, "two words.example.invalid", `${HOST}?x=1`];
const BAD_IDS: unknown[] = ["not-a-uuid", `${UUID}0`, UUID.slice(1), UUID.replaceAll("-", ""), HOST, `x${UUID}`];

for (const [home, make] of HOMES) {
  describe(`AC-STE-871.1 — ${home}: task_tracking.jira site and cloud_id`, () => {
    test(`AC-STE-871.1: ${home}: both keys are returned`, () => {
      expect(read(make("jira", [["site", HOST], ["cloud_id", UUID]]))).toMatchObject({ project: "ZZ", site: HOST, cloudId: UUID });
    });
    test(`AC-STE-871.1: ${home}: site alone leaves cloudId absent`, () => {
      const b = read(make("jira", [["site", HOST]]));
      expect(b.site).toBe(HOST);
      expect(Object.keys(b)).not.toContain("cloudId");
    });
    test(`AC-STE-871.1: ${home}: cloud_id alone leaves site absent`, () => {
      const b = read(make("jira", [["cloud_id", UUID]]));
      expect(b.cloudId).toBe(UUID);
      expect(Object.keys(b)).not.toContain("site");
    });
    test(`AC-STE-871.1: ${home}: neither key — the binding is unchanged`, () => {
      expect(read(make("jira", []))).toEqual({ project: "ZZ", shared: false });
    });
    test(`AC-STE-871.1: ${home}: site is stored lower case`, () => {
      expect(read(make("jira", [["site", "Tracker.EXAMPLE.invalid"]])).site).toBe(HOST);
    });
    test(`AC-STE-871.1: ${home}: an upper-case cloud_id is accepted`, () => {
      expect(String(read(make("jira", [["cloud_id", UUID.toUpperCase()]])).cloudId).toLowerCase()).toBe(UUID);
    });
    for (const blank of ["", "   "]) {
      test(`AC-STE-871.1: ${home}: blank ${JSON.stringify(blank)} values read as absent`, () => {
        expect(read(make("jira", [["site", blank], ["cloud_id", blank]]))).toEqual({ project: "ZZ", shared: false });
      });
    }
    for (const v of BAD_SITES) test(`AC-STE-871.1: ${home}: site ${JSON.stringify(v)} is no host and refuses`, () => refusal(make("jira", [["site", v]]), "site"));
    for (const v of BAD_IDS) test(`AC-STE-871.1: ${home}: cloud_id ${JSON.stringify(v)} is no UUID and refuses`, () => refusal(make("jira", [["cloud_id", v]]), "cloud_id"));
    for (const [k, v] of [["site", HOST], ["cloud_id", UUID]] as const) {
      test(`AC-STE-871.1: ${home}: ${k} under Linear refuses`, () => refusal(make("linear", [[k, v]]), k, "linear"));
    }
  });
}

describe("AC-STE-871.1 — one home only", () => {
  for (const [k, a, b] of [["site", HOST, "other.example.invalid"], ["cloud_id", UUID, OTHER_UUID]] as const) {
    test(`AC-STE-871.1: legacy: a duplicate ${k} line refuses`, () => refusal(legacy("jira", [[k, a], [k, b]]), k));
    test(`AC-STE-871.1: legacy: a blank ${k} under Linear reads as absent`, () => {
      expect(read(legacy("linear", [[k, ""]]), "linear")).toEqual({ team: "ZZT", project: "ZZ", shared: false });
    });
    for (const v of [42, ["x"], { x: 1 }]) test(`AC-STE-871.1: settings file: a non-string ${k} ${JSON.stringify(v)} refuses`, () => refusal(settings("jira", [[k, v]]), k));
  }
});

// ------------------------------------------------------------ the comparison

interface SiteModule {
  siteMatches: (b: { site?: string; cloudId?: string }, cloudId: unknown) => boolean;
  browseHostMatches: (b: { site?: string; cloudId?: string }, url: string) => boolean;
}
const SITE_MODULE = join(PLUGIN_ROOT, "adapters", "_shared", "src", "atlassian_site.ts");
const mod = async (): Promise<SiteModule> => (await import(SITE_MODULE)) as SiteModule;

const BOTH = { site: HOST, cloudId: UUID };
const SITE_ONLY = { site: HOST };
const ID_ONLY = { cloudId: UUID };
const ID_FORMS = [UUID, UUID.toUpperCase()];
const HOST_FORMS = [HOST, HOST.toUpperCase(), `https://${HOST}`, `https://${HOST}/`, `HTTPS://${HOST.toUpperCase()}`];
const MISMATCHES: unknown[] = [
  OTHER_UUID,
  "other.example.invalid",
  `a.${HOST}`,
  `x${HOST}`,
  `${HOST}.evil.example.invalid`,
  `${HOST}x`,
  `https://${HOST}.evil.example.invalid`,
  `https://a.${HOST}`,
  `http://${HOST}`,
  `https://${HOST}:8443`,
  `https://user@${HOST}`,
  `https://other.example.invalid/${HOST}`,
  `https://other.example.invalid#${HOST}`,
  `${HOST}.`,
  `${UUID}0`,
  undefined,
  null,
  "",
  "   ",
  42,
  true,
  [UUID],
  [HOST],
  { id: UUID },
];
const text = (v: unknown): string => (v === undefined ? "undefined" : JSON.stringify(v));

describe("AC-STE-871.2 — siteMatches", () => {
  for (const v of [...ID_FORMS, ...HOST_FORMS]) test(`AC-STE-871.2: both declared: ${text(v)} matches`, async () => expect((await mod()).siteMatches(BOTH, v)).toBe(true));
  for (const v of MISMATCHES) test(`AC-STE-871.2: both declared: ${text(v)} is a mismatch`, async () => expect((await mod()).siteMatches(BOTH, v)).toBe(false));
  for (const v of HOST_FORMS) {
    test(`AC-STE-871.2: site only: ${text(v)} matches`, async () => expect((await mod()).siteMatches(SITE_ONLY, v)).toBe(true));
    test(`AC-STE-871.2: cloud_id only: ${text(v)} is a mismatch`, async () => expect((await mod()).siteMatches(ID_ONLY, v)).toBe(false));
  }
  for (const v of ID_FORMS) {
    test(`AC-STE-871.2: cloud_id only: ${text(v)} matches`, async () => expect((await mod()).siteMatches(ID_ONLY, v)).toBe(true));
    test(`AC-STE-871.2: site only: ${text(v)} is a mismatch`, async () => expect((await mod()).siteMatches(SITE_ONLY, v)).toBe(false));
  }
  for (const v of MISMATCHES) test(`AC-STE-871.2: neither declared: ${text(v)} matches`, async () => expect((await mod()).siteMatches({}, v)).toBe(true));
});

const path = "/browse/ZZ-7";
const FOREIGN_URLS = [`https://other.example.invalid${path}`, `http://${HOST}${path}`, `https://${HOST}:8443${path}`, `https://u@${HOST}${path}`, `https://${HOST}.${path}`, `https://a.${HOST}${path}`, `https://${HOST}.evil.example.invalid${path}`, `https://x${HOST}${path}`];

describe("AC-STE-871.5 — browseHostMatches", () => {
  for (const u of [`https://${HOST}${path}`, `https://${HOST.toUpperCase()}${path}`, `https://${HOST}${path}?x=1`]) test(`AC-STE-871.5: ${u} matches the declared site`, async () => expect((await mod()).browseHostMatches(BOTH, u)).toBe(true));
  for (const u of FOREIGN_URLS) {
    test(`AC-STE-871.5: ${u} is a mismatch`, async () => expect((await mod()).browseHostMatches(SITE_ONLY, u)).toBe(false));
    test(`AC-STE-871.5: cloud_id only: ${u} resolves as today`, async () => expect((await mod()).browseHostMatches(ID_ONLY, u)).toBe(true));
    test(`AC-STE-871.5: neither declared: ${u} resolves as today`, async () => expect((await mod()).browseHostMatches({}, u)).toBe(true));
  }
});

// ---------------------------------------------------------------------- docs

/** The lines within 15 of a `cloud_id` mention. */
function around(rel: string): string {
  const lines = readFileSync(join(PLUGIN_ROOT, rel), "utf-8").split("\n");
  const hits = lines.flatMap((l, i) => (/\bcloud_id\b/.test(l) ? [i] : []));
  return lines.filter((_, i) => hits.some((h) => Math.abs(h - i) <= 15)).join("\n");
}
const FACTS: Array<[string, RegExp]> = [
  ["names cloud_id", /\bcloud_id\b/],
  ["names the site key", /`(?:task_tracking\.jira\.)?site:?`/],
  ["says the keys are optional", /\boptional\b/i],
  ["says where to read the values", /getAccessibleAtlassianResources/],
  ["says an older client refuses an unknown key", /\bolder\b[\s\S]{0,200}\brefuse|\brefuse[\s\S]{0,200}\bolder\b/i],
  ["names the floor to raise", /\bmin_dpt_version\b/],
  ["says to raise the floor", /\brais(?:e|ed|ing)\b/i],
];
describe("AC-STE-871.9 — the keys are documented", () => {
  for (const rel of ["docs/settings-reference.md", "adapters/jira.md", "docs/setup-tracker-mode.md"]) {
    for (const [what, re] of FACTS) test(`AC-STE-871.9: ${rel} ${what}`, () => expect(around(rel)).toMatch(re));
  }
  test("AC-STE-871.9: /setup (its skill or its reference) documents both keys as optional", () => {
    const t = around("skills/setup/SKILL.md") + around("docs/setup-reference.md");
    expect(t).toMatch(/\bcloud_id\b/);
    expect(t).toMatch(/`(?:task_tracking\.jira\.)?site:?`/);
    expect(t).toMatch(/\boptional\b/i);
  });
});
