import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// STE-81 — adapter contract parity.
//
// The STE-65 pre-state guard and the `TrackerWriteNoOpError` post-write guard
// in `adapters/_shared/src/tracker_provider.ts` fire for every adapter, not
// just Linear. Until M22 the trap documentation only lived in
// `adapters/linear.md`; `adapters/jira.md` shipped without parity. This test
// locks the backport invariant: both adapter docs declare both traps, and
// the `_template.md` carries the slot structure so future adapters follow
// the same shape by default.
//
// The read_status assertion (AC-STE-81.6) is also a grep-gate: the capability
// had zero consumers across the plugin, so declaring it in linear.md was a
// dead reference. The test asserts the string doesn't reappear.

const pluginRoot = join(import.meta.dir, "..");
const linearPath = join(pluginRoot, "adapters", "linear.md");
const jiraPath = join(pluginRoot, "adapters", "jira.md");
const templatePath = join(pluginRoot, "adapters", "_template.md");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("STE-81 AC-STE-81.1/2 — Jira adapter declares both trap subsections", () => {
  test("jira.md carries a `claimLock-skipped trap` subsection referencing STE-65", () => {
    const body = read(jiraPath);
    expect(body).toMatch(/###\s+claimLock-skipped trap/);
    expect(body).toContain("STE-65");
  });

  test("jira.md names the TrackerReleaseLockPreconditionError error type", () => {
    const body = read(jiraPath);
    expect(body).toContain("TrackerReleaseLockPreconditionError");
  });

  test("jira.md carries a `Silent no-op trap` subsection", () => {
    const body = read(jiraPath);
    expect(body).toMatch(/###?\s+Silent no-op trap/i);
  });

  test("jira.md names TrackerWriteNoOpError and the updatedAt guard", () => {
    const body = read(jiraPath);
    expect(body).toContain("TrackerWriteNoOpError");
    expect(body).toContain("updatedAt");
  });

  test("jira.md flags the backported no-op section as provisional pending live-MCP introspection (H3)", () => {
    const body = read(jiraPath);
    expect(body).toMatch(/provisional|tentative|pending live/i);
  });
});

describe("STE-81 AC-STE-81.3/6 — read_status capability deleted from linear.md (and no other hits)", () => {
  test("linear.md frontmatter no longer declares read_status", () => {
    const body = read(linearPath);
    expect(body).not.toContain("read_status");
  });

  test("no file under adapters/ or skills/ mentions read_status", () => {
    const hits: string[] = [];
    const scanDirs = ["adapters", "skills", "docs"];
    for (const dir of scanDirs) {
      walk(join(pluginRoot, dir), (f, body) => {
        if (body.includes("read_status")) hits.push(f);
      });
    }
    expect(hits).toEqual([]);
  });
});

describe("STE-81 AC-STE-81.4 — _template.md declares MCP tool names + adapter-specific traps slots", () => {
  test("_template.md has a `## MCP tool names` section slot (required)", () => {
    const body = read(templatePath);
    expect(body).toMatch(/^##\s+MCP tool names/m);
  });

  test("_template.md has an `### Adapter-specific traps` slot inside `## Operations`", () => {
    const body = read(templatePath);
    expect(body).toMatch(/###\s+Adapter-specific traps/);
    // Must appear after the `## Operations` heading (or equivalent 4-Op section)
    // so contributors fill it in the right place.
    const trapsIdx = body.search(/###\s+Adapter-specific traps/);
    const opsIdx = body.search(/##\s+(Operations|4-Op Interface)/);
    expect(opsIdx).toBeGreaterThan(-1);
    expect(trapsIdx).toBeGreaterThan(opsIdx);
  });
});

describe("STE-81 AC-STE-81.5 — linear.md and jira.md both declare required _template.md sections", () => {
  test("linear.md declares `## MCP tool names`", () => {
    expect(read(linearPath)).toMatch(/^##\s+MCP tool names/m);
  });

  test("jira.md declares `## MCP tool names`", () => {
    expect(read(jiraPath)).toMatch(/^##\s+MCP tool names/m);
  });

  test("linear.md declares `## Operations`", () => {
    expect(read(linearPath)).toMatch(/^##\s+Operations/m);
  });

  test("jira.md declares `## Operations`", () => {
    expect(read(jiraPath)).toMatch(/^##\s+Operations/m);
  });
});

function walk(dir: string, visit: (path: string, body: string) => void): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, visit);
    } else if (entry.endsWith(".md") || entry.endsWith(".ts")) {
      visit(full, readFileSync(full, "utf8"));
    }
  }
}
