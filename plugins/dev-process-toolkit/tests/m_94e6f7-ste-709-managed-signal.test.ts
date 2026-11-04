// STE-709 AC-STE-709.1 — the settings file is the fourth managed-tree signal.
//
// `tests/toolkit-managed-predicate.test.ts` keeps its STE-432 assertions
// unchanged; the new `settings_file` rows live here so that file's pins stay
// byte-identical (AC-STE-709.8).
//
// Contract graded:
//   * `settings_file` is present when `specs/settings.yaml` exists as a regular
//     file and is not foreign (a foreign file carries neither a top-level
//     `schema_version:` nor `min_dpt_version:` line at column 0).
//   * `DETECTORS` order is setup_marker, task_tracking_section, docs_section,
//     settings_file — so `settings_file` is appended LAST.
//   * Presence is the evidence: an unreadable file, or a malformed one that
//     carries either key at column 0, still yields the signal; nothing throws.
//   * A foreign file yields no signal: alone it leaves the tree unmanaged, and
//     beside a legacy CLAUDE.md the signals equal those of the same tree
//     without the file.
//
// AC-STE-709.13 (mutation control): removing the `settings_file` detector reds
// every "settings_file" row below — they are the named rows for that mutation.

import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { SETUP_MARKER, detectManagedSignals, isToolkitManaged } from "../adapters/_shared/src/toolkit_managed";

const ROOTS: string[] = [];
afterAll(() => {
  for (const r of ROOTS) {
    rmSync(r, { recursive: true, force: true });
  }
});

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "ste709-signal-"));
  ROOTS.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return root;
}

const VALID_SETTINGS = 'schema_version: 1\nmin_dpt_version: "2.0.0"\n';
const POINTER_ONLY_CLAUDE_MD =
  "# Synthetic Project\n\n## Project Settings\n\nProject settings live in `specs/settings.yaml` (requires dev-process-toolkit >= 2.0.0).\n\n## Key Commands\n\n- `bun test`\n";
const LEGACY_CLAUDE_MD = `${SETUP_MARKER}\n# Synthetic Project\n\n## Task Tracking\n\nmode: none\n`;

describe("AC-STE-709.1 settings_file is a managed-tree signal", () => {
  test("a tree holding only specs/settings.yaml and a CLAUDE.md with no moved heading and no marker is managed", () => {
    const root = tree({ "CLAUDE.md": POINTER_ONLY_CLAUDE_MD, "specs/settings.yaml": VALID_SETTINGS });
    expect(isToolkitManaged(root)).toBe(true);
    expect(detectManagedSignals(root) as string[]).toEqual(["settings_file"]);
  });

  test("a tree holding only specs/settings.yaml (no CLAUDE.md) reports exactly [settings_file]", () => {
    const root = tree({ "specs/settings.yaml": VALID_SETTINGS });
    expect(detectManagedSignals(root) as string[]).toEqual(["settings_file"]);
    expect(isToolkitManaged(root)).toBe(true);
  });

  test("settings_file is appended LAST when other signals are present", () => {
    const root = tree({ "CLAUDE.md": `${SETUP_MARKER}\n# P\n`, "specs/settings.yaml": VALID_SETTINGS });
    expect(detectManagedSignals(root) as string[]).toEqual(["setup_marker", "settings_file"]);
  });

  test("settings_file follows every heading signal too (DETECTORS order)", () => {
    // Detection never calls the loader, so the both-homes shape is fine here.
    const root = tree({
      "CLAUDE.md": `${SETUP_MARKER}\n# P\n\n## Task Tracking\n\nmode: none\n\n## Docs\n\nuser_facing_mode: false\n`,
      "specs/settings.yaml": VALID_SETTINGS,
    });
    expect(detectManagedSignals(root) as string[]).toEqual([
      "setup_marker",
      "task_tracking_section",
      "docs_section",
      "settings_file",
    ]);
  });

  test("`ignore: [\"settings_file\"]` removes the only evidence of a settings-only tree", () => {
    const root = tree({ "specs/settings.yaml": VALID_SETTINGS });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(isToolkitManaged(root, { ignore: ["settings_file" as any] })).toBe(false);
    expect(isToolkitManaged(root, { ignore: ["docs_section"] })).toBe(true);
  });

  test("a malformed settings file carrying `schema_version:` at column 0 still yields the signal and never throws", () => {
    const root = tree({ "specs/settings.yaml": "schema_version: [\n  : : unterminated\n" });
    expect(() => detectManagedSignals(root)).not.toThrow();
    expect(detectManagedSignals(root) as string[]).toEqual(["settings_file"]);
    expect(isToolkitManaged(root)).toBe(true);
  });

  test("a malformed settings file carrying only `min_dpt_version:` at column 0 still yields the signal", () => {
    const root = tree({ "specs/settings.yaml": "min_dpt_version: not-a-version\ntask_tracking: [oops\n" });
    expect(detectManagedSignals(root) as string[]).toEqual(["settings_file"]);
  });

  test("an unreadable settings file still yields the signal and never throws", () => {
    const root = tree({ "specs/settings.yaml": VALID_SETTINGS });
    chmodSync(join(root, "specs", "settings.yaml"), 0o000);
    let signals: string[] = [];
    expect(() => {
      signals = detectManagedSignals(root) as string[];
    }).not.toThrow();
    const managed = isToolkitManaged(root);
    chmodSync(join(root, "specs", "settings.yaml"), 0o644);
    expect(signals).toEqual(["settings_file"]);
    expect(managed).toBe(true);
  });

  test("a directory named specs/settings.yaml is not a regular file: no signal, no throw", () => {
    const root = tree({ "specs/settings.yaml/keep": "" });
    expect(() => detectManagedSignals(root)).not.toThrow();
    expect(detectManagedSignals(root) as string[]).toEqual([]);
    expect(isToolkitManaged(root)).toBe(false);
  });
});

describe("AC-STE-709.1 a foreign settings file is no signal", () => {
  const FOREIGN = "service:\n  name: synthetic\n  port: 8080\n";

  test("alone, a foreign file leaves isToolkitManaged false and yields no signal", () => {
    const root = tree({ "specs/settings.yaml": FOREIGN });
    expect(detectManagedSignals(root) as string[]).toEqual([]);
    expect(isToolkitManaged(root)).toBe(false);
  });

  test("an indented `schema_version:` (not column 0) is still foreign", () => {
    const root = tree({ "specs/settings.yaml": "app:\n  schema_version: 1\n  min_dpt_version: 2.0.0\n" });
    expect(detectManagedSignals(root) as string[]).toEqual([]);
    expect(isToolkitManaged(root)).toBe(false);
  });

  test("beside a legacy CLAUDE.md the signals equal those of the same tree without the file", () => {
    const withFile = tree({ "CLAUDE.md": LEGACY_CLAUDE_MD, "specs/settings.yaml": FOREIGN });
    const without = tree({ "CLAUDE.md": LEGACY_CLAUDE_MD });
    expect(detectManagedSignals(without) as string[]).toEqual(["setup_marker", "task_tracking_section"]);
    expect(detectManagedSignals(withFile)).toEqual(detectManagedSignals(without));
  });

  test("control: the same legacy tree with a toolkit settings file DOES gain settings_file (falsifies the row above)", () => {
    const root = tree({ "CLAUDE.md": LEGACY_CLAUDE_MD, "specs/settings.yaml": VALID_SETTINGS });
    expect(detectManagedSignals(root) as string[]).toEqual(["setup_marker", "task_tracking_section", "settings_file"]);
  });
});
