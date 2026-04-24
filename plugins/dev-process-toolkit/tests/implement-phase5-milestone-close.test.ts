import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// STE-75 — /implement Phase 5 milestone close prompt.
//
// Opt-in chain at the end of a successful milestone-scope run. Prose
// assertions lock the skill surface so a future SKILL.md edit cannot
// silently collapse the prompt into an auto-chain, drop the TTY gate,
// or misplace the "last thing before exit" guarantee (AC-STE-75.7).

const pluginRoot = join(import.meta.dir, "..");
const skillPath = join(pluginRoot, "skills", "implement", "SKILL.md");

function readSkill(): string {
  return readFileSync(skillPath, "utf8");
}

function phase5Block(body: string): string {
  const start = body.indexOf("## Phase 5");
  expect(start).toBeGreaterThan(-1);
  const end = body.indexOf("## Rules", start);
  expect(end).toBeGreaterThan(start);
  return body.slice(start, end);
}

describe("AC-STE-75.7 — Phase 5 sub-step placement + last-before-exit", () => {
  test("SKILL.md declares '## Phase 5: Milestone close prompt (STE-75)'", () => {
    const body = readSkill();
    expect(body).toMatch(/##\s+Phase 5:\s*Milestone close prompt \(STE-75\)/);
  });

  test("Phase 5 lands AFTER Phase 4 Close and BEFORE the Rules section", () => {
    const body = readSkill();
    const closeIdx = body.indexOf("Phase 4 Close");
    const phase5Idx = body.indexOf("## Phase 5");
    const rulesIdx = body.indexOf("## Rules");
    expect(closeIdx).toBeGreaterThan(-1);
    expect(phase5Idx).toBeGreaterThan(closeIdx);
    expect(rulesIdx).toBeGreaterThan(phase5Idx);
  });

  test("Phase 5 block cites the 'last thing before exit' invariant", () => {
    const phase5 = phase5Block(readSkill());
    // AC-STE-75.7 pins Phase 5 as the terminal sub-step — nothing else
    // runs between its prompt and process exit.
    expect(phase5).toMatch(/last thing|last step|before (process )?exit|nothing else (runs|happens)/i);
  });
});

describe("AC-STE-75.1 — exact prompt format", () => {
  test("Phase 5 contains the literal prompt header 'All FRs in M<N> shipped.'", () => {
    const phase5 = phase5Block(readSkill());
    expect(phase5).toContain("All FRs in M<N> shipped.");
  });

  test("Phase 5 contains the literal question line 'Run /ship-milestone M<N> now? (y/n):'", () => {
    const phase5 = phase5Block(readSkill());
    expect(phase5).toContain("Run /ship-milestone M<N> now? (y/n):");
  });

  test("the two prompt lines are separated by a blank line (AC-STE-75.1 exact format)", () => {
    const phase5 = phase5Block(readSkill());
    // Prompt spec: header line, blank line, then the Run? question.
    expect(phase5).toMatch(
      /All FRs in M<N> shipped\.\r?\n\s*\r?\n\s*Run \/ship-milestone M<N> now\? \(y\/n\):/,
    );
  });
});

describe("AC-STE-75.2 — `y` / `yes` (case-insensitive) chains into /ship-milestone", () => {
  test("Phase 5 names the /ship-milestone M<N> chain target", () => {
    const phase5 = phase5Block(readSkill());
    expect(phase5).toContain("/ship-milestone M<N>");
  });

  test("Phase 5 documents case-insensitive y/yes acceptance", () => {
    const phase5 = phase5Block(readSkill());
    expect(phase5).toMatch(/case-insensitive/i);
    expect(phase5).toMatch(/`y`|`yes`|y \/ yes|y\/yes/);
  });

  test("Phase 5 states /ship-milestone's own gates still fire on chain", () => {
    const phase5 = phase5Block(readSkill());
    // The chain does not bypass any ship-milestone pre-flight or
    // approval gate — AC-STE-75.2 / AC-STE-75.6 joint invariant.
    expect(phase5).toMatch(/own gates?|all of \/ship-milestone's|ship-milestone's own|gates? still fire/i);
  });
});

describe("AC-STE-75.3 — decline / empty / non-matching answer prints the hint and exits 0", () => {
  test("Phase 5 contains the literal hint line", () => {
    const phase5 = phase5Block(readSkill());
    expect(phase5).toContain("Ready to close milestone. Run: /ship-milestone M<N>");
  });

  test("Phase 5 documents that n/no/empty/other does NOT chain", () => {
    const phase5 = phase5Block(readSkill());
    expect(phase5).toMatch(/does not chain|no chain|skip the chain|not chain/i);
  });

  test("Phase 5 documents the clean-exit (exit 0) on decline", () => {
    const phase5 = phase5Block(readSkill());
    expect(phase5).toMatch(/exit 0|exits 0|exit cleanly|clean exit/i);
  });
});

describe("AC-STE-75.4 — prompt is skipped entirely in 5 named cases", () => {
  test("Phase 5 lists single-FR invocation as a skip case", () => {
    const phase5 = phase5Block(readSkill());
    expect(phase5).toMatch(/single[- ]FR|FR-scope|per-FR arg|FR[- ]?id arg|STE-\d+/);
  });

  test("Phase 5 lists `all` invocation as a skip case", () => {
    const phase5 = phase5Block(readSkill());
    expect(phase5).toMatch(/`all`|\ball\b arg|'all'/);
  });

  test("Phase 5 lists the no-arg / empty invocation as a skip case", () => {
    const phase5 = phase5Block(readSkill());
    expect(phase5).toMatch(/no arg|no argument|empty arg|empty invocation/i);
  });

  test("Phase 5 lists 'any FR still active' as a skip case", () => {
    const phase5 = phase5Block(readSkill());
    expect(phase5).toMatch(/status:\s*active|still active|unshipped FR/i);
  });

  test("Phase 5 lists 'any FR gate-check failed' as a skip case", () => {
    const phase5 = phase5Block(readSkill());
    expect(phase5).toMatch(/gate[- ]check failed|partial failure|partial success/i);
  });

  test("Phase 5 lists non-TTY stdin as a skip (prints hint instead)", () => {
    const phase5 = phase5Block(readSkill());
    expect(phase5).toMatch(/TTY|non-interactive|CI context|piped/i);
    // Non-TTY path still prints the hint per AC-STE-75.4.
    expect(phase5).toMatch(/hint/i);
  });
});

describe("AC-STE-75.5 — ship-milestone-failed-to-start surfaces NFR-10", () => {
  test("Phase 5 documents the chain-failure refusal with NFR-10 shape", () => {
    const phase5 = phase5Block(readSkill());
    expect(phase5).toMatch(/attempted to chain into \/ship-milestone but it failed to start/);
    expect(phase5).toMatch(/Remedy:[\s\S]*Context:/);
  });

  test("Phase 5 documents the non-zero exit on chain-failure", () => {
    const phase5 = phase5Block(readSkill());
    expect(phase5).toMatch(/exits? non-zero|exit non-zero/i);
  });
});

describe("AC-STE-75.6 — y on chain prompt does NOT pre-approve the release", () => {
  test("Phase 5 documents that ship-milestone's approval gate is the deciding gate", () => {
    const phase5 = phase5Block(readSkill());
    // y here only starts ship-milestone; the release commit is gated by
    // ship-milestone's own `Apply? [y/N]` prompt on the release diff.
    expect(phase5).toMatch(/does not pre-approve|not pre-approve|ship-milestone's? own (approval )?gate|deciding gate|second gate/i);
  });

  test("Phase 5 documents that refusal at the second gate exits cleanly without a release commit", () => {
    const phase5 = phase5Block(readSkill());
    expect(phase5).toMatch(/refusal.*(second|ship-milestone|release)|no release commit|exits? cleanly/i);
  });
});

