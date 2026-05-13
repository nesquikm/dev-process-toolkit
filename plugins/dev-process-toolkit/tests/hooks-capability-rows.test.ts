import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// STE-285 AC-STE-285.4 — `/setup` final summary report carries
// `hooks_installed` (or `hooks_skipped`) capability rows with the static
// plain-language map verbatim. Doc-conformance grep.

const SKILL_PATH = join(
  import.meta.dir,
  "..",
  "skills",
  "setup",
  "SKILL.md",
);

function read(): string {
  return readFileSync(SKILL_PATH, "utf-8");
}

describe("AC-STE-285.4 — hooks_installed capability row documented in /setup SKILL.md", () => {
  test("SKILL.md mentions `hooks_installed` key at least once", () => {
    const body = read();
    expect(body).toContain("hooks_installed");
  });

  test("hooks_installed row text names the toggle-off remedy via .claude/settings.json", () => {
    const body = read();
    // The static plain-language map text:
    // "Installed N opt-in toolkit-contract enforcement hook(s): <list of names>
    //  — toggle off any hook by editing .claude/settings.json"
    // We check the load-bearing fragments rather than the exact string so
    // minor wording adjustments don't churn the test.
    expect(body).toMatch(/Installed.*opt-in.*toolkit-contract.*enforcement.*hook/i);
    expect(body).toMatch(/toggle off.*\.claude\/settings\.json/i);
  });
});

describe("AC-STE-285.4 — hooks_skipped capability row documented in /setup SKILL.md", () => {
  test("SKILL.md mentions `hooks_skipped` key at least once", () => {
    const body = read();
    expect(body).toContain("hooks_skipped");
  });

  test("hooks_skipped row text names the /setup --hooks remedy", () => {
    const body = read();
    // The static plain-language map text:
    // "User declined opt-in hooks during /setup — run /setup --hooks to
    //  reconsider, or edit .claude/settings.json manually"
    expect(body).toMatch(/declined.*opt-in.*hook/i);
    expect(body).toMatch(/\/setup\s+--hooks/);
  });
});
