import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// STE-74 — /implement Phase 4b doc-fragment hook.
//
// The hook sits between gate-pass (4a) and the existing Close procedure
// (4c/4d). These prose assertions lock the skill surface so future
// SKILL.md edits can't silently drop the `readDocsConfig` gate, the 60s
// timeout, or the non-blocking failure path.
//
// They complement `implement-phase4-close.test.ts` (STE-54), which keeps
// owning the commit → releaseLock → getTicketStatus assertions. The
// byte-identical regression for the Close procedure (AC-STE-74.7) is
// satisfied by that test file remaining unmodified.

const pluginRoot = join(import.meta.dir, "..");
const skillPath = join(pluginRoot, "skills", "implement", "SKILL.md");

function readSkill(): string {
  return readFileSync(skillPath, "utf8");
}

function phase4Block(body: string): string {
  const start = body.indexOf("## Phase 4");
  expect(start).toBeGreaterThan(-1);
  const end = body.indexOf("## Rules", start);
  expect(end).toBeGreaterThan(start);
  return body.slice(start, end);
}

describe("AC-STE-74.1 — Phase 4b sub-step declared at the 4a/4c boundary", () => {
  test("Phase 4 names 'Phase 4b: Doc fragment' as an explicit sub-step", () => {
    const phase4 = phase4Block(readSkill());
    expect(phase4).toMatch(/Phase 4b:\s*Doc fragment/);
  });

  test("Phase 4b sits between the gate (4a) and the Close procedure (4c/4d)", () => {
    const phase4 = phase4Block(readSkill());
    const fourBIdx = phase4.indexOf("Phase 4b");
    const closeIdx = phase4.indexOf("Phase 4 Close");
    expect(fourBIdx).toBeGreaterThan(-1);
    expect(closeIdx).toBeGreaterThan(fourBIdx);
  });

  test("Phase 4 surface labels the gate as 4a and Close sub-steps as 4c/4d", () => {
    const phase4 = phase4Block(readSkill());
    // The 4a / 4c / 4d labels are load-bearing — AC-STE-74.1 uses them to
    // pin the ordering, and /spec-review / duck-council references cite
    // them by name.
    expect(phase4).toMatch(/Phase 4a/);
    expect(phase4).toMatch(/Phase 4c/);
    expect(phase4).toMatch(/Phase 4d/);
  });
});

describe("AC-STE-74.2 — 4b invokes /docs --quick with the current FR", () => {
  test("Phase 4b body invokes /docs --quick", () => {
    const phase4 = phase4Block(readSkill());
    expect(phase4).toMatch(/\/docs\s+--quick/);
  });

  test("Phase 4b reuses the /docs resolver (no new --fr argument on /implement)", () => {
    const phase4 = phase4Block(readSkill());
    // The hook must not introduce a new surface — AC-STE-74.8 forbids a
    // new flag; AC-STE-74.2 pins the FR ID to the resolver /docs --quick
    // already uses.
    expect(phase4).toMatch(/current FR|resolver|branch_template|same as|manual \/docs/i);
  });
});

describe("AC-STE-74.3 — readDocsConfig gate with silent no-op", () => {
  test("Phase 4b cites readDocsConfig as the gate", () => {
    const phase4 = phase4Block(readSkill());
    expect(phase4).toContain("readDocsConfig");
  });

  test("both-false / absent section is a silent no-op (no log, no row)", () => {
    const phase4 = phase4Block(readSkill());
    expect(phase4).toMatch(/silent no-op|silently|no log|no output/i);
    // zero-output invariant spelled out so the byte-identical regression
    // (AC-STE-74.7) is visibly the intent, not a side effect.
    expect(phase4).toMatch(/no deviation-report row|no row|zero output/i);
  });
});

describe("AC-STE-74.4 — success adds a Deviation Report row", () => {
  test("Phase 4b documents the success row shape", () => {
    const phase4 = phase4Block(readSkill());
    // AC-STE-74.4 prescribes the exact cell content.
    expect(phase4).toMatch(/\| Doc fragment \| added \| docs\/\.pending\/<fr-id>\.md \| — \|/);
  });
});

describe("AC-STE-74.5 — failure is non-blocking with a skipped row", () => {
  test("Phase 4b documents the skipped-row shape with the error excerpt", () => {
    const phase4 = phase4Block(readSkill());
    expect(phase4).toMatch(/\| Doc fragment \| skipped \(error\) \| — \| \/docs --quick failed:/);
    expect(phase4).toMatch(/Run manually after commit to retry/);
  });

  test("failure path continues to Phase 4c (non-blocking)", () => {
    const phase4 = phase4Block(readSkill());
    expect(phase4).toMatch(/non-blocking|continues?|proceeds?/i);
    // the commit itself must not be blocked by a fragment failure — this
    // is the core invariant from STE-74 Notes ("A missing fragment is
    // better than a failed implementation commit").
    expect(phase4).toMatch(/does not block|never block|continue to (Phase )?4c/i);
  });
});

describe("AC-STE-74.6 — 60-second timeout", () => {
  test("Phase 4b declares a 60-second timeout", () => {
    const phase4 = phase4Block(readSkill());
    expect(phase4).toMatch(/60[- ]second|60s/);
  });

  test("timeout routes through the AC-STE-74.5 skipped-row path", () => {
    const phase4 = phase4Block(readSkill());
    expect(phase4).toMatch(/timeout after 60s/);
  });
});

describe("AC-STE-74.7 — byte-identical regression when disabled", () => {
  test("existing Phase 4 Close anchors remain intact", () => {
    const phase4 = phase4Block(readSkill());
    // The three Close mechanisms (commit → releaseLock → getTicketStatus)
    // and the atomic Close subheading must survive the STE-74 edits.
    // implement-phase4-close.test.ts owns the ordering assertion; we lock
    // the surface here too so a future cleanup can't collapse the Close
    // block under Phase 4b by accident.
    expect(phase4).toMatch(/Phase 4 Close \(atomic/);
    expect(phase4).toContain("releaseLock");
    expect(phase4).toContain("getTicketStatus");
  });
});

describe("AC-STE-74.8 — no new /implement flag", () => {
  test("argument-hint frontmatter is unchanged (no --skip-docs / --force-docs)", () => {
    const body = readSkill();
    const frontmatterEnd = body.indexOf("\n---\n", 4);
    expect(frontmatterEnd).toBeGreaterThan(-1);
    const frontmatter = body.slice(0, frontmatterEnd);
    expect(frontmatter).not.toContain("--skip-docs");
    expect(frontmatter).not.toContain("--force-docs");
  });

  test("Phase 4b surface does not mention a /implement --skip-docs flag", () => {
    const phase4 = phase4Block(readSkill());
    expect(phase4).not.toMatch(/--skip-docs|--force-docs/);
  });
});
