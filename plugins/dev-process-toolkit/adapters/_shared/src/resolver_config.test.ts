// Tier 4 unit tests for buildResolverConfig (FR-65, AC-65.1..65.8).
//
// Covers every branch: mode absent / mode: none (empty trackers), primary
// mode, primary + secondary_tracker, malformed adapter metadata (missing
// file / missing resolver block / invalid regex in either pattern field).

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildResolverConfig, MalformedAdapterMetadataError } from "./resolver_config";

let work: string;
let claudeMdPath: string;
let adaptersDir: string;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "dpt-rcfg-"));
  claudeMdPath = join(work, "CLAUDE.md");
  adaptersDir = join(work, "adapters");
  mkdirSync(adaptersDir, { recursive: true });
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

function writeAdapter(name: string, body: string): void {
  writeFileSync(join(adaptersDir, `${name}.md`), body);
}

const LINEAR_ADAPTER = `---
name: linear
mcp_server: linear
ticket_id_regex: '^(?:[A-Z]{2,10})-([0-9]+)$'
resolver:
  id_pattern: '^[A-Z]+-\\d+$'
  url_host: 'linear.app'
  url_path_regex: '/[^/]+/issue/([A-Z]+-\\d+)'
---

# Linear Adapter
`;

const JIRA_ADAPTER = `---
name: jira
mcp_server: jira
ticket_id_regex: '^[A-Z]+-\\d+$'
resolver:
  id_pattern: '^[A-Z]+-\\d+$'
  url_host: 'example.atlassian.net'
  url_path_regex: '/browse/([A-Z]+-\\d+)'
---

# Jira Adapter
`;

function claudeMd(mode: string | null, extras = ""): string {
  if (mode === null) {
    return `# Project\n\nSome project without Task Tracking.\n`;
  }
  return `# Project

Some project.

## Task Tracking

mode: ${mode}
${extras}
`;
}

describe("buildResolverConfig", () => {
  test("AC-65.7 — CLAUDE.md without `## Task Tracking` section returns { trackers: [] }", () => {
    writeFileSync(claudeMdPath, claudeMd(null));
    writeAdapter("linear", LINEAR_ADAPTER);
    const cfg = buildResolverConfig(claudeMdPath, adaptersDir);
    expect(cfg.trackers).toHaveLength(0);
  });

  test("AC-65.7 — `mode: none` returns { trackers: [] }", () => {
    writeFileSync(claudeMdPath, claudeMd("none"));
    writeAdapter("linear", LINEAR_ADAPTER);
    const cfg = buildResolverConfig(claudeMdPath, adaptersDir);
    expect(cfg.trackers).toHaveLength(0);
  });

  test("AC-65.3/65.4 — `mode: linear` returns one tracker with compiled regex that matches LIN-1234", () => {
    writeFileSync(claudeMdPath, claudeMd("linear"));
    writeAdapter("linear", LINEAR_ADAPTER);
    const cfg = buildResolverConfig(claudeMdPath, adaptersDir);
    expect(cfg.trackers).toHaveLength(1);
    const t = cfg.trackers[0]!;
    expect(t.key).toBe("linear");
    expect(t.idPattern).toBeInstanceOf(RegExp);
    expect(t.idPattern.test("LIN-1234")).toBe(true);
    expect(t.idPattern.test("lowercase-42")).toBe(false);
    expect(t.urlHost).toBe("linear.app");
    expect(t.urlPathRegex.test("/my-team/issue/LIN-1234/title-slug")).toBe(true);
  });

  test("AC-65.3 — `mode: jira` returns one jira tracker (jira-only shape)", () => {
    writeFileSync(claudeMdPath, claudeMd("jira", "jira_ac_field: customfield_10042"));
    writeAdapter("jira", JIRA_ADAPTER);
    const cfg = buildResolverConfig(claudeMdPath, adaptersDir);
    expect(cfg.trackers).toHaveLength(1);
    expect(cfg.trackers[0]?.key).toBe("jira");
    expect(cfg.trackers[0]?.urlHost).toBe("example.atlassian.net");
    expect(cfg.trackers[0]?.urlPathRegex.test("/browse/PROJ-77")).toBe(true);
  });

  test("AC-65.3 — primary `mode:` + `secondary_tracker:` returns both trackers, primary first", () => {
    writeFileSync(claudeMdPath, claudeMd("linear", "secondary_tracker: jira"));
    writeAdapter("linear", LINEAR_ADAPTER);
    writeAdapter("jira", JIRA_ADAPTER);
    const cfg = buildResolverConfig(claudeMdPath, adaptersDir);
    expect(cfg.trackers.map((t) => t.key)).toEqual(["linear", "jira"]);
  });

  test("AC-65.6 — adapter file missing throws MalformedAdapterMetadataError", () => {
    writeFileSync(claudeMdPath, claudeMd("linear"));
    // No linear.md under adaptersDir.
    expect(() => buildResolverConfig(claudeMdPath, adaptersDir)).toThrow(MalformedAdapterMetadataError);
  });

  test("AC-65.6 — adapter present but `resolver:` block missing throws MalformedAdapterMetadataError", () => {
    writeFileSync(claudeMdPath, claudeMd("linear"));
    writeAdapter(
      "linear",
      `---
name: linear
mcp_server: linear
---

# Linear (no resolver block)
`,
    );
    expect(() => buildResolverConfig(claudeMdPath, adaptersDir)).toThrow(MalformedAdapterMetadataError);
  });

  test("AC-65.6 — invalid `id_pattern` regex throws MalformedAdapterMetadataError", () => {
    writeFileSync(claudeMdPath, claudeMd("linear"));
    writeAdapter(
      "linear",
      `---
name: linear
resolver:
  id_pattern: '[invalid('
  url_host: 'linear.app'
  url_path_regex: '/[^/]+/issue/([A-Z]+-\\d+)'
---

# Linear (broken id regex)
`,
    );
    expect(() => buildResolverConfig(claudeMdPath, adaptersDir)).toThrow(MalformedAdapterMetadataError);
  });

  test("AC-65.6 — invalid `url_path_regex` throws MalformedAdapterMetadataError", () => {
    writeFileSync(claudeMdPath, claudeMd("linear"));
    writeAdapter(
      "linear",
      `---
name: linear
resolver:
  id_pattern: '^[A-Z]+-\\d+$'
  url_host: 'linear.app'
  url_path_regex: '[broken('
---

# Linear (broken url regex)
`,
    );
    expect(() => buildResolverConfig(claudeMdPath, adaptersDir)).toThrow(MalformedAdapterMetadataError);
  });
});
