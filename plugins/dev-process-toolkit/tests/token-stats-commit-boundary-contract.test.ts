import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// STE-346 — commit-boundary prose contracts (AC-STE-346.1, .2, .3, .4).
//
// Prose-contract meta-tests (same shape as token-stats-spec-write-contract
// .test.ts): readFileSync the skill surfaces and assert they carry the
// literal directives. Content presence only — SKILL.md line caps are owned
// by the existing meta-tests, not here.
//
// AC-STE-346.1 — skills/implement/SKILL.md § Milestone Archival re-renders
//   each in-scope FR's `## Token Stats` block from the ledger via STE-345's
//   `upsertTokenStatsBlock`, after the `git mv` / frontmatter flip and
//   before the commit, so it rides the SAME archive commit — no separate
//   commit, no post-commit dirty tree; vacuous when the ledger has no rows
//   for the FR.
// AC-STE-346.2 — skills/ship-milestone/SKILL.md renders the milestone
//   rollup into specs/plan/M<N>.md via `renderMilestoneRollup` and stages
//   it into the release commit; sentinel-fenced + idempotent. The milestone
//   plan template documents the optional rollup section.
// AC-STE-346.3 — the ship-milestone wiring names the design/exploration
//   bucket for brainstorm rows never claimed by any FR.
// AC-STE-346.4 — both wirings fold the render into their existing staged
//   commit (never a standalone working-tree mutation).

const pluginRoot = join(import.meta.dir, "..");
const implementPath = join(pluginRoot, "skills", "implement", "SKILL.md");
const shipPath = join(pluginRoot, "skills", "ship-milestone", "SKILL.md");
const specWritePath = join(pluginRoot, "skills", "spec-write", "SKILL.md");
const planTemplatePath = join(
  pluginRoot,
  "templates",
  "spec-templates",
  "plan.md.template",
);

const MENTION = "Token Stats";

function implementBody(): string {
  return readFileSync(implementPath, "utf8");
}

function shipBody(): string {
  return readFileSync(shipPath, "utf8");
}

function specWriteBody(): string {
  return readFileSync(specWritePath, "utf8");
}

/** All ±window slices around each `Token Stats` mention in a body. */
function tokenStatsWindows(body: string): string[] {
  const windows: string[] = [];
  let idx = body.indexOf(MENTION);
  while (idx !== -1) {
    windows.push(body.slice(Math.max(0, idx - 1200), idx + 1400));
    idx = body.indexOf(MENTION, idx + MENTION.length);
  }
  return windows;
}

/** The § Milestone Archival slice of implement/SKILL.md (heading → next heading). */
function milestoneArchivalSection(): string {
  const body = implementBody();
  const idx = body.indexOf("### Milestone Archival");
  expect(idx).toBeGreaterThan(-1);
  const next = body.slice(idx + 1).search(/\n#{1,4} /);
  return next === -1 ? body.slice(idx) : body.slice(idx, idx + 1 + next);
}

// "Folded into the already-happening commit" — the AC-346.4 language family.
const FOLD_RE =
  /same (?:archive |release )?commit|no (?:separate|new) commit|into the (?:same )?(?:archive|release) commit|rides? the (?:archive|release) commit/i;
const STANDALONE_RE =
  /dirty[- ]tree|standalone|loose working[- ]tree/i;

describe("AC-STE-346.1 — /implement Phase 4 re-renders the FR Token Stats block inside the archive commit", () => {
  test("§ Milestone Archival names the block, the ledger, and upsertTokenStatsBlock", () => {
    const section = milestoneArchivalSection();
    expect(section).toContain(MENTION);
    expect(section).toMatch(/upsertTokenStatsBlock/);
    expect(section).toMatch(/ledger/i);
  });

  test("ordering pinned: after git mv / frontmatter flip, before the commit — same archive commit", () => {
    const windows = tokenStatsWindows(milestoneArchivalSection());
    expect(windows.length).toBeGreaterThan(0);
    expect(
      windows.some((w) => /after[\s\S]{0,240}?(git mv|frontmatter flip|flip)/i.test(w)),
    ).toBe(true);
    expect(
      windows.some((w) => /before[\s\S]{0,200}?commit/i.test(w)),
    ).toBe(true);
    expect(windows.some((w) => FOLD_RE.test(w))).toBe(true);
  });

  test("vacuous path documented: ledger absent or no rows for the FR ⇒ skip", () => {
    const windows = tokenStatsWindows(milestoneArchivalSection());
    expect(
      windows.some(
        (w) => /vacuous/i.test(w) && /(no rows|absent|empty)/i.test(w),
      ),
    ).toBe(true);
  });

  test("no separate commit, no post-commit dirty tree (AC-346.4 leg)", () => {
    const windows = tokenStatsWindows(milestoneArchivalSection());
    expect(windows.some((w) => FOLD_RE.test(w))).toBe(true);
    expect(windows.some((w) => STANDALONE_RE.test(w))).toBe(true);
  });
});

describe("AC-STE-346.2 — /ship-milestone renders the milestone rollup inside the release commit", () => {
  test("SKILL.md names the rollup, the ledger, and renderMilestoneRollup, targeting the plan file", () => {
    const body = shipBody();
    expect(body).toContain(MENTION);
    expect(body).toMatch(/renderMilestoneRollup/);

    const windows = tokenStatsWindows(body);
    expect(windows.some((w) => /ledger/i.test(w))).toBe(true);
    // The render target is the milestone plan file.
    expect(
      windows.some((w) => /specs\/plan|M<N>\.md|resolved plan/i.test(w)),
    ).toBe(true);
  });

  test("staged into the release commit — never a commit of its own", () => {
    const windows = tokenStatsWindows(shipBody());
    expect(
      windows.some((w) => /release commit/i.test(w) && /stag\w*|git add/i.test(w)),
    ).toBe(true);
    expect(windows.some((w) => FOLD_RE.test(w))).toBe(true);
  });

  test("rollup content named: per-FR subtotals, (main-loop), and milestone total", () => {
    const windows = tokenStatsWindows(shipBody());
    expect(
      windows.some(
        (w) =>
          w.includes("(main-loop)") &&
          /total/i.test(w) &&
          /per[- ]FR|subtotal/i.test(w),
      ),
    ).toBe(true);
  });

  test("sentinel-fenced + idempotent mechanics stated", () => {
    const windows = tokenStatsWindows(shipBody());
    expect(
      windows.some(
        (w) =>
          /idempotent/i.test(w) &&
          /sentinel|fenced|token-stats:begin/i.test(w),
      ),
    ).toBe(true);
  });

  test("milestone plan template documents the optional Token Stats rollup section", () => {
    const template = readFileSync(planTemplatePath, "utf8");
    expect(template).toContain(MENTION);

    const windows = tokenStatsWindows(template);
    expect(windows.some((w) => /optional/i.test(w))).toBe(true);
    expect(
      windows.some((w) => /ship-milestone|rollup|machine[- ]managed/i.test(w)),
    ).toBe(true);
  });
});

describe("AC-STE-346.3 — design/exploration bucket wired into the ship-milestone rollup", () => {
  test("SKILL.md names design/exploration for brainstorm rows never claimed by any FR", () => {
    const windows = tokenStatsWindows(shipBody());
    expect(
      windows.some(
        (w) =>
          w.includes("design/exploration") &&
          /brainstorm/i.test(w) &&
          /unclaimed|never claimed|no [`]?claimed_by|without [`]?claimed_by/i.test(w),
      ),
    ).toBe(true);
  });
});

describe("AC-STE-346.4 — both wirings fold the render into their existing staged commit", () => {
  test("neither render is ever a standalone working-tree mutation", () => {
    for (const body of [milestoneArchivalSection(), shipBody()]) {
      const windows = tokenStatsWindows(body);
      expect(windows.length).toBeGreaterThan(0);
      expect(windows.some((w) => FOLD_RE.test(w))).toBe(true);
      expect(windows.some((w) => STANDALONE_RE.test(w))).toBe(true);
    }
  });
});

// STE-379 AC-STE-379.2 — render-site gates. All three `## Token Stats` render
// sites must skip their render when `readTokenStatsConfig(...).enabled === false`:
//   (1) /spec-write § 0b Step 7 (FR-file block),
//   (2) /implement § Milestone Archival "Token Stats re-render",
//   (3) /ship-milestone § 7 milestone rollup.
// Byte-checkable, like the probe #44 MUST-emit directives: the prose window
// around each render site references the readTokenStatsConfig `enabled` flag
// AND states a skip/no-render when the flag is off.

/**
 * A render-site prose window "gates on disabled" when it references
 * readTokenStatsConfig, names the `enabled` flag, states a skip/no-render, and
 * ties that skip to the OFF/false/disabled state.
 */
function gatesOnDisabled(window: string): boolean {
  return (
    /readTokenStatsConfig/.test(window) &&
    /\benabled\b/.test(window) &&
    /\b(skip|skips|skipped|no[- ]?render|render(?:s|ed)? nothing|writes? nothing|write nothing|emit(?:s)? nothing|no block|do(?:es)? not (?:render|write)|no ## Token Stats)\b/i.test(
      window,
    ) &&
    /(disabled|===?\s*false|is\s+false|enabled:\s*false|\boff\b|not enabled)/i.test(
      window,
    )
  );
}

describe("AC-STE-379.2 — all three render sites skip when `## Token Stats` is disabled", () => {
  test("(1) /spec-write § 0b Step 7 render site gates on readTokenStatsConfig().enabled", () => {
    const windows = tokenStatsWindows(specWriteBody());
    expect(windows.length).toBeGreaterThan(0);
    expect(windows.some(gatesOnDisabled)).toBe(true);
  });

  test("(2) /implement § Milestone Archival re-render gates on readTokenStatsConfig().enabled", () => {
    const windows = tokenStatsWindows(milestoneArchivalSection());
    expect(windows.length).toBeGreaterThan(0);
    expect(windows.some(gatesOnDisabled)).toBe(true);
  });

  test("(3) /ship-milestone § 7 rollup gates on readTokenStatsConfig().enabled", () => {
    const windows = tokenStatsWindows(shipBody());
    expect(windows.length).toBeGreaterThan(0);
    expect(windows.some(gatesOnDisabled)).toBe(true);
  });
});
