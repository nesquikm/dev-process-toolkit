// STE-648 (M_163656) — the hooks reference names the in-place install.
//
// `docs/hooks-reference.md` described only a copied install (cache under
// `~/.claude/plugins/cache/…`) and claimed an update "propagate[s]
// automatically … (no user action needed)". Both are false for a
// local-directory marketplace, which loads the source working tree in place:
// CLAUDE_PLUGIN_ROOT is that tree, script bodies change at their next firing,
// and hooks.json registrations change only at session start or on
// /reload-plugins. A copied install keeps its old paths until then.
//
// Every AC leg below reds at the pre-fix HEAD for the reason its AC states;
// the legs labelled CONTROL are keep-behaviour and pass on both sides.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DOC = join(import.meta.dir, "..", "docs", "hooks-reference.md");
const doc = (): string => readFileSync(DOC, "utf-8");

/** The body of a `## <heading>` section, up to the next level-2 heading. */
function section(text: string, heading: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start < 0) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^## /.test(l));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n");
}

const harness = (): string => section(doc(), "How the harness loads these hooks");
const override = (): string => section(doc(), "Override pattern");
const linesOf = (s: string): string[] => s.split("\n").filter((l) => l.trim() !== "");

describe("CONTROL — the sections the ACs grade are found and non-empty", () => {
  test("CONTROL: the harness-loading section is found and carries prose", () => {
    const s = harness();
    expect(s.trim().length, "the section heading was found").toBeGreaterThan(200);
    expect(linesOf(s).length).toBeGreaterThan(3);
  });

  test("CONTROL: the override-pattern section is found and carries prose", () => {
    const s = override();
    expect(s.trim().length).toBeGreaterThan(200);
  });

  test("CONTROL: 'directory' and the literal ${CLAUDE_PLUGIN_ROOT} token are present in the harness section (present before and after the fix)", () => {
    expect(harness()).toContain("directory");
    expect(harness()).toContain("${CLAUDE_PLUGIN_ROOT}");
  });

  test("CONTROL: the kept install-shape facts survive the rewrite — hooks/hooks.json, seven command-type entries, timeout: 5000 in seconds, the fail-open leg", () => {
    const s = harness();
    expect(s).toContain("hooks/hooks.json");
    expect(s).toContain("seven `command`-type entries");
    expect(s).toContain("timeout: 5000");
    expect(s).toContain("**seconds**");
    expect(s).toContain("Fail-open on missing session log");
  });
});

describe("AC-STE-648.1 — the two false phrases are gone", () => {
  test("AC-STE-648.1: docs/hooks-reference.md does not contain 'not any dev-clone path'", () => {
    expect(doc()).not.toContain("not any dev-clone path");
  });

  test("AC-STE-648.1: docs/hooks-reference.md does not contain 'no user action needed'", () => {
    expect(doc()).not.toContain("no user action needed");
  });
});

describe("AC-STE-648.2 — a local-directory marketplace loads the working tree in place", () => {
  test("AC-STE-648.2: the harness section names the working tree", () => {
    expect(harness()).toContain("working tree");
  });

  test("AC-STE-648.2: a line says CLAUDE_PLUGIN_ROOT is the source working tree for a local-directory marketplace", () => {
    const hit = linesOf(harness()).filter(
      (l) => l.includes("CLAUDE_PLUGIN_ROOT") && l.includes("working tree") && /director/i.test(l),
    );
    expect(hit.length, "one line ties CLAUDE_PLUGIN_ROOT to the source working tree of a directory marketplace").toBeGreaterThan(0);
  });

  test("AC-STE-648.2: a line says the running version and floor are read from that tree's plugin.json", () => {
    const hit = linesOf(harness()).filter(
      (l) => l.includes("plugin.json") && /\bversion\b/.test(l) && /\bfloor\b/.test(l),
    );
    expect(hit.length).toBeGreaterThan(0);
  });
});

describe("AC-STE-648.3 — a hooks.json change waits for a restart or /reload-plugins", () => {
  test("AC-STE-648.3: the harness section names /reload-plugins", () => {
    expect(harness()).toContain("/reload-plugins");
  });

  test("AC-STE-648.3: a line says a hooks.json change takes effect only after a restart or /reload-plugins", () => {
    const hit = linesOf(harness()).filter(
      (l) => l.includes("hooks.json") && l.includes("/reload-plugins") && /restart/i.test(l),
    );
    expect(hit.length).toBeGreaterThan(0);
  });

  test("AC-STE-648.3: a line says a copied install keeps its old paths until then", () => {
    const hit = linesOf(harness()).filter((l) => /cop(y|ied)/i.test(l) && /old\b.{0,30}\bpaths?\b/i.test(l));
    expect(hit.length).toBeGreaterThan(0);
  });

  test("AC-STE-648.3: the copied-install cache lives under $CLAUDE_CONFIG_DIR", () => {
    expect(harness()).toContain("CLAUDE_CONFIG_DIR");
    expect(harness()).toContain("$CLAUDE_CONFIG_DIR/plugins/cache/");
  });
});

describe("AC-STE-648.4 — the override recipe names both install shapes", () => {
  test("AC-STE-648.4: the override recipe writes the cache path under $CLAUDE_CONFIG_DIR", () => {
    expect(override()).toContain("$CLAUDE_CONFIG_DIR/plugins/cache/");
  });

  test("AC-STE-648.4: the override recipe no longer hardcodes ~/.claude/plugins/cache", () => {
    expect(override()).not.toContain("~/.claude/plugins/cache");
  });

  test("AC-STE-648.4: the override recipe names where the script lives for a local-directory marketplace (the working tree)", () => {
    const s = override();
    expect(s).toContain("working tree");
    expect(s).toContain("templates/hooks/process/<name>.sh");
  });
});
