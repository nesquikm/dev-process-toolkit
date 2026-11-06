// STE-714 AC.9 / AC.12 — the committed measurement files (the note plus every
// directory in SCRUBBED_FIXTURE_DIRS) carry synthetic identifiers only.
//
// The scan lives in this file on purpose: AC-STE-714.10 forbids the FR from
// shipping behaviour, so no adapter module is added or imported here.

import { afterAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const NOTE_PATH = join(REPO_ROOT, "specs", "notes", "ste-714-hook-payload-measurement.md");

// Paths are relative to the plugin root. STE-715 appends
// "tests/fixtures/m_7bc805-gate-slices/" when it commits its slices.
// Amended by AC-STE-715.16 (M_7bc805): the live gate-check slices are scanned too.
export const SCRUBBED_FIXTURE_DIRS: readonly string[] = ["tests/fixtures/hook-payloads/", "tests/fixtures/m_7bc805-gate-slices/"];

export type RuleName = "users-path" | "home-path" | "slug" | "email" | "git-branch" | "uuid" | "api-id";

export interface Finding {
  file: string;
  rule: RuleName;
  match: string;
}

type Rule = { name: RuleName; find: (text: string) => string[] };

// Synthetic blocks of the scrub table, as the scrub produced them:
//   session ids: 00000000-0000-4000-8000-0000000000NN
//   record ids:  00000000-0000-4000-8000-0000001000NN
const SYNTHETIC_UUID = /^00000000-0000-4000-8000-(?:0000000000\d{2}|0000001000\d{2})$/;
const UUID = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;

const all = (re: RegExp) => (text: string) => [...text.matchAll(re)].map((m) => m[0]);

export const RULES: readonly Rule[] = [
  { name: "users-path", find: all(/\/Users\//g) },
  { name: "home-path", find: all(/\/home\//g) },
  // A cwdToSlug project folder: -Users-<name>... or -home-<name>... The
  // scrub table's own placeholder `-Users-<name>-...` is not a real slug.
  { name: "slug", find: all(/(?<![A-Za-z0-9])-(?:Users|home)-[A-Za-z0-9_.]/g) },
  { name: "email", find: all(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g) },
  {
    name: "git-branch",
    find: (text) =>
      // Also the escaped form a JSON string embeds, \"gitBranch\":\"...\".
      [...text.matchAll(/\\?"gitBranch\\?"\s*:\s*\\?"([^"\\]*)/g)]
        .filter((m) => m[1] !== "synthetic-branch")
        .map((m) => m[0]),
  },
  { name: "uuid", find: (text) => all(UUID)(text).filter((u) => !SYNTHETIC_UUID.test(u)) },
  // Claude Code's own non-UUID ids: tool-use ids, API message / request ids
  // and 17-character fork agent ids. Only the scrub's SYNTH forms may appear.
  {
    name: "api-id",
    find: (text) =>
      all(/\b(?:toolu|msg|req)_[A-Za-z0-9]{8,}\b|\ba[0-9a-f]{16}\b/g)(text).filter((m) => !/_SYNTH_\d+$/.test(m)),
  },
];

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...listFiles(p));
    else out.push(p);
  }
  return out.sort();
}

export function scanFiles(files: readonly string[], rules: readonly Rule[] = RULES): Finding[] {
  const findings: Finding[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const rule of rules) {
      for (const match of rule.find(text)) findings.push({ file, rule: rule.name, match });
    }
  }
  return findings;
}

export function scannedFiles(dirs: readonly string[] = SCRUBBED_FIXTURE_DIRS, root = PLUGIN_ROOT): string[] {
  return [NOTE_PATH, ...dirs.flatMap((d) => listFiles(join(root, d)))];
}

const without = (name: RuleName) => RULES.filter((r) => r.name !== name);

// Controls: copy one committed fixture to a temp dir, plant one identifier per row.
const tmpRoot = mkdtempSync(join(tmpdir(), "ste-714-controls-"));
afterAll(() => rmSync(tmpRoot, { recursive: true, force: true }));

const SOURCE_FIXTURE = join(PLUGIN_ROOT, "tests", "fixtures", "hook-payloads", "pre-bash-exit-0.json");

type Control = { label: string; rule: RuleName; plant: (json: Record<string, unknown>) => void };

const CONTROLS: readonly Control[] = [
  {
    label: "/Users/someone",
    rule: "users-path",
    plant: (j) => {
      j.cwd = "/Users/someone";
    },
  },
  {
    label: "slug -Users-someone-repo",
    rule: "slug",
    plant: (j) => {
      j.slug_note = "projects/-Users-someone-repo";
    },
  },
  {
    label: "real-shaped parentUuid",
    rule: "uuid",
    plant: (j) => {
      j.parentUuid = "3f2a9c1e-7b4d-4e8a-9f21-6c5d0b7a1e33";
    },
  },
  {
    label: "/home/someone path",
    rule: "home-path",
    plant: (j) => {
      j.home = "/home/someone/repo";
    },
  },
  {
    label: "email address",
    rule: "email",
    plant: (j) => {
      j.author = "someone@example.org";
    },
  },
  {
    label: "escaped non-synthetic gitBranch inside a string",
    rule: "git-branch",
    plant: (j) => {
      j.tool_response = { stdout: '{\"gitBranch\":\"feat/real-branch\"}' };
    },
  },
  {
    label: "real-shaped tool_use_id",
    rule: "api-id",
    plant: (j) => {
      j.tool_use_id = "toolu_01AbCdEfGhIjKlMnOpQrStUv";
    },
  },
  {
    label: "real-shaped fork agent id",
    rule: "api-id",
    plant: (j) => {
      j.agent_id = "a2f0c9d81e7b6a543";
    },
  },
];

// Copy SOURCE_FIXTURE into tmpRoot as <name>.json after applying plant().
function writePlanted(name: string, plant: Control["plant"]): string {
  const json = JSON.parse(readFileSync(SOURCE_FIXTURE, "utf8")) as Record<string, unknown>;
  plant(json);
  const path = join(tmpRoot, `${name}.json`);
  writeFileSync(path, JSON.stringify(json, null, 2));
  return path;
}

const plantedCopy = (control: Control): string =>
  writePlanted(`${control.rule}-${control.label.replace(/[^a-z0-9]+/gi, "-")}`, control.plant);

describe("STE-714 synthetic identifiers", () => {
  test("SCRUBBED_FIXTURE_DIRS ships with the hook-payloads directory, and every listed dir is non-empty", () => {
    expect(SCRUBBED_FIXTURE_DIRS).toContain("tests/fixtures/hook-payloads/");
    for (const d of SCRUBBED_FIXTURE_DIRS) {
      const files = listFiles(join(PLUGIN_ROOT, d));
      expect(files.length).toBeGreaterThan(0);
    }
    // 18 payload JSONs + 2 transcript slices committed by this FR.
    const payloads = listFiles(join(PLUGIN_ROOT, "tests/fixtures/hook-payloads/"));
    expect(payloads.filter((f) => f.endsWith(".json")).length).toBe(18);
    expect(payloads.filter((f) => f.endsWith(".jsonl")).length).toBe(2);
  });

  test("committed measurement files carry synthetic identifiers only", () => {
    const files = scannedFiles();
    expect(files).toContain(NOTE_PATH);
    expect(scanFiles(files)).toEqual([]);
  });

  test("the scanned files do contain synthetic identifiers (scan is not vacuous)", () => {
    const text = scannedFiles()
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    expect(text).toContain("00000000-0000-4000-8000-000000000002");
    expect(text).toMatch(/00000000-0000-4000-8000-0000001\d{5}/);
    expect(text).toContain('"gitBranch": "synthetic-branch"');
  });

  test("control: an unplanted copy of the fixture scans clean", () => {
    const path = join(tmpRoot, "clean.json");
    copyFileSync(SOURCE_FIXTURE, path);
    expect(scanFiles([path])).toEqual([]);
  });

  for (const control of CONTROLS) {
    test(`control: planted ${control.label} is reported by the same scan`, () => {
      const findings = scanFiles([plantedCopy(control)]);
      expect(findings.map((f) => f.rule)).toContain(control.rule);
    });

    // AC-STE-714.12: removing the rule turns this control red, i.e. the
    // planted file then passes the scan.
    test(`mutation: scan without the ${control.rule} rule misses planted ${control.label}`, () => {
      const findings = scanFiles([plantedCopy(control)], without(control.rule));
      expect(findings).toEqual([]);
    });
  }

  test("control: an email, /home/ path and a non-synthetic gitBranch are reported", () => {
    const path = writePlanted("misc", (j) => {
      j.author = "someone@example.org";
      j.home = "/home/someone/repo";
      j.gitBranch = "feat/real-branch";
    });
    const rules = scanFiles([path]).map((f) => f.rule);
    expect(rules).toContain("email");
    expect(rules).toContain("home-path");
    expect(rules).toContain("git-branch");
  });

  test("AC-STE-714.10: this test imports no adapter, hook or skill code", () => {
    const src = readFileSync(import.meta.path, "utf8");
    const imports = [...src.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const spec of imports) expect(spec).toMatch(/^(bun:test|node:[a-z]+)$/);
  });
});
