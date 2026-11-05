// STE-707 AC-STE-707.3 / AC-STE-707.4 — one settings reader.
//
// The scan walks every non-test `.ts` file under `adapters/_shared/src`,
// `templates/hooks` and `scripts`, and fails on any non-comment line holding:
//   - a moved heading as a WHOLE string literal (`"## Docs"`, `'### Linear'`, ...);
//   - a string literal ending in `tracker-config.yaml`;
//   - a regex anchored on one of the moved headings (`/^##\s+Docs\s*$/m`, ...);
//   - a call to `videoConfigPath(` or `videoStylePath(`.
//
// A moved heading quoted inside a longer message (``"no `## Release Files`
// heading found"``) is prose, not a parse anchor, and does not count.
//
// Two allowlists, each entry with its recorded reason:
//   - PERMANENT: the loader's legacy module, `migrations/legacy_paths.ts`,
//     `migrations/entries/settings_file.ts` (STE-711), every registry entry
//     under `migrations/entries/` whose `introduced_in` is below 3.0.0 (they
//     edit the legacy home before `settings-file` runs, by registry order),
//     `dpt_paths.ts`, and `token_stats_render.ts`.
//   - TEMPORARY: the probe modules STE-709 owns and the writer modules STE-710
//     owns, derived by running this scan on the STE-707 drafting tree and
//     listing the hits outside the permanent list. Each FR empties its part;
//     the list is empty when M_94e6f7 ships. An entry whose module no longer
//     hits is stale and reds its own row, so the list only ever shrinks.
//
// AC-STE-707.4 — the control: a planted fixture module with a `"## Docs"`
// literal turns the scanner red, and the same literal inside a `//` comment
// does not.

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";

const PLUGIN = resolve(import.meta.dir, "..");
const SCAN_ROOTS = ["adapters/_shared/src", "templates/hooks", "scripts"];
const ENTRIES_DIR = "adapters/_shared/src/migrations/entries";

const MOVED_HEADINGS = [
  "## Task Tracking",
  "### Linear",
  "### Jira",
  "## Verification",
  "## Docs",
  "## Orchestration",
  "## Token Stats",
  "## Release Files",
];

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const HEADING_ALT = MOVED_HEADINGS.map(esc).join("|");
const HEADING_NAMES = "Task Tracking|Linear\\b|Jira\\b|Verification\\b|Docs\\b|Orchestration\\b|Token Stats|Release Files";

/** The four offence shapes, each with the name a failure reports. */
const RULES: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: "moved heading as a whole string literal", re: new RegExp(`(["'])(?:${HEADING_ALT})\\1`) },
  { name: "literal ending in tracker-config.yaml", re: /(["'])[^"'\n]*tracker-config\.yaml\1/ },
  { name: "regex anchored on a moved heading", re: new RegExp(`\\^\\\\?s*#[^\\n]{0,16}?(?:${HEADING_NAMES})`) },
  { name: "call to videoConfigPath / videoStylePath", re: /\bvideo(?:Config|Style)Path\s*\(/ },
];

interface Hit {
  file: string;
  line: number;
  rule: string;
  text: string;
}

function isCommentLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith("//") || t.startsWith("/*") || t.startsWith("*");
}

function walkTs(dir: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      walkTs(p, out);
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) {
      out.push(p);
    }
  }
}

/** Every offending line under `roots` (each relative to `base`), reported relative to `base`. */
function scanForPrivateSettingsReads(base: string, roots: readonly string[]): Hit[] {
  const files: string[] = [];
  for (const r of roots) walkTs(join(base, r), files);
  const hits: Hit[] = [];
  for (const f of files.sort()) {
    const lines = readFileSync(f, "utf8").split("\n");
    lines.forEach((text, i) => {
      if (isCommentLine(text)) return;
      for (const rule of RULES) {
        if (rule.re.test(text)) {
          hits.push({ file: relative(base, f), line: i + 1, rule: rule.name, text: text.trim() });
          break;
        }
      }
    });
  }
  return hits;
}

// ---------------------------------------------------------------------------
// The allowlists
// ---------------------------------------------------------------------------

const PERMANENT: Record<string, string> = {
  "adapters/_shared/src/project_settings_legacy.ts":
    "the loader's legacy module — the one place the v2.101.4 CLAUDE.md, tracker-config and video-config parses live",
  "adapters/_shared/src/migrations/legacy_paths.ts": "names the legacy homes the migrations rewrite",
  "adapters/_shared/src/migrations/entries/settings_file.ts":
    "STE-711's migration moves the legacy homes into specs/settings.yaml, so it reads them by name",
  "adapters/_shared/src/dpt_paths.ts": "the sole composer of `.dpt/` path literals, including the legacy video config paths",
  "adapters/_shared/src/token_stats_render.ts":
    "its `## Token Stats` is the FR-file block heading, not the CLAUDE.md section",
};

/** Registry entries below 3.0.0 edit the legacy home before `settings-file` runs, by registry order. */
function preV3Entries(): Record<string, string> {
  const out: Record<string, string> = {};
  const dir = join(PLUGIN, ENTRIES_DIR);
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
    const m = /introduced_in:\s*["'](\d+)\.\d+\.\d+["']/.exec(readFileSync(join(dir, name), "utf8"));
    if (m && Number(m[1]) < 3) {
      out[`${ENTRIES_DIR}/${name}`] = `registry entry introduced below 3.0.0 — edits the legacy home before \`settings-file\` runs`;
    }
  }
  return out;
}

const TEMPORARY: Record<string, { owner: "STE-710" | "STE-709"; reason: string }> = {
};

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

describe("AC-STE-707.3 one reader: no module outside the allowlists parses a moved home", () => {
  const hits = scanForPrivateSettingsReads(PLUGIN, SCAN_ROOTS);
  const allowed = { ...PERMANENT, ...preV3Entries() };

  test("AC-.3 every registry entry named at drafting is on the permanent allowlist", () => {
    for (const name of ["v1_orphans.ts", "mode_none_sequential_milestone.ts", "verification_run_keys.ts"]) {
      expect(Object.keys(allowed)).toContain(`${ENTRIES_DIR}/${name}`);
    }
  });

  test("AC-.3 every allowlist entry carries a recorded reason", () => {
    for (const [file, reason] of Object.entries(allowed)) expect([file, reason.length > 10]).toEqual([file, true]);
    for (const [file, e] of Object.entries(TEMPORARY)) {
      expect([file, e.reason.length > 10, ["STE-709", "STE-710"].includes(e.owner)]).toEqual([file, true, true]);
      expect([file, file in allowed]).toEqual([file, false]);
    }
  });

  test("AC-.3 no hit outside the permanent and temporary allowlists", () => {
    const offending = hits
      .filter((h) => !(h.file in allowed) && !(h.file in TEMPORARY))
      .map((h) => `${h.file}:${h.line} [${h.rule}] ${h.text}`);
    expect(offending).toEqual([]);
  });

  test("AC-.3 the temporary allowlist holds no stale entry (each module still hits)", () => {
    const hitFiles = new Set(hits.map((h) => h.file));
    const stale = Object.keys(TEMPORARY).filter((f) => !hitFiles.has(f));
    expect(stale).toEqual([]);
  });

  test("AC-.3 the scan sees every root it names", () => {
    const files: string[] = [];
    for (const r of SCAN_ROOTS) walkTs(join(PLUGIN, r), files);
    for (const r of SCAN_ROOTS) {
      expect([r, files.some((f) => relative(PLUGIN, f).startsWith(`${r}/`))]).toEqual([r, true]);
    }
    // Test files are never scanned.
    expect(files.some((f) => basename(f).endsWith(".test.ts"))).toBe(false);
  });
});

describe("AC-STE-707.4 the one-reader scan's control", () => {
  const ROOTS: string[] = [];
  afterAll(() => {
    for (const r of ROOTS) rmSync(r, { recursive: true, force: true });
  });

  function planted(body: string): string {
    const base = mkdtempSync(join(tmpdir(), "ste707-scan-"));
    ROOTS.push(base);
    mkdirSync(join(base, "adapters", "_shared", "src"), { recursive: true });
    writeFileSync(join(base, "adapters", "_shared", "src", "planted_fixture.ts"), body);
    return base;
  }

  test('AC-.4 a planted module with a "## Docs" literal turns the scan red', () => {
    const base = planted('export const HEADING = "## Docs";\n');
    const hits = scanForPrivateSettingsReads(base, SCAN_ROOTS);
    expect(hits.map((h) => [h.file, h.line, h.rule])).toEqual([
      ["adapters/_shared/src/planted_fixture.ts", 1, "moved heading as a whole string literal"],
    ]);
  });

  test('AC-.4 the same "## Docs" literal inside a // comment does not', () => {
    const base = planted('// export const HEADING = "## Docs";\nexport const OTHER = 1;\n');
    expect(scanForPrivateSettingsReads(base, SCAN_ROOTS)).toEqual([]);
  });

  test("AC-.4 each offence shape is caught on its own planted line", () => {
    const base = planted(
      [
        "const a = '### Jira';",
        'const b = join(specs, "tracker-config.yaml");',
        "const c = /^##\\s+Release Files\\s*$/m;",
        "const d = videoStylePath(root);",
        'const e = "no `## Release Files` heading found";',
      ].join("\n"),
    );
    expect(scanForPrivateSettingsReads(base, SCAN_ROOTS).map((h) => h.line)).toEqual([1, 2, 3, 4]);
  });
});
