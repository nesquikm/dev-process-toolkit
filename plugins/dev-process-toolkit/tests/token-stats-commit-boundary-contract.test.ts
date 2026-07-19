import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
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
const implementReferencePath = join(
  pluginRoot,
  "docs",
  "implement-reference.md",
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

// STE-396 AC-STE-396.4 — callers re-render after demotion.
//
// The shared-session demotion is necessarily RETROACTIVE: the first FR of a
// session cannot know a second is coming, so a claim run for FR-B rewrites
// rows that FR-A's already-written block still reports. Both render sites must
// therefore make a SECOND pass — re-rendering the `## Token Stats` block for
// every FR they touched in the run, after all claims have settled — otherwise
// an FR written before a later demotion keeps a block the ledger no longer
// supports. Prose contract, same shape as the AC-STE-346.x checks above.

/** The render site re-renders, covers every touched FR, and does so post-settle. */
function reRendersAfterClaimsSettle(window: string): boolean {
  const reRenders = /re-?render/i.test(window);
  const everyTouchedFR =
    /every FR|all FRs|each FR|every in-scope FR|per in-scope FR|all in-scope FRs|every touched FR|each touched FR/i.test(
      window,
    );
  // The retroactive-demotion trigger: a second pass, run once claims settle.
  const afterSettle =
    /claims? (?:have )?settle|after all claims|once all claims|second pass|demot(?:e|ed|es|ion)/i.test(
      window,
    );
  return reRenders && everyTouchedFR && afterSettle;
}

describe("AC-STE-396.4 — both claim sites re-render every touched FR after all claims settle", () => {
  test("/spec-write § 0b Step 7 carries the post-settle re-render directive", () => {
    const windows = tokenStatsWindows(specWriteBody());
    expect(windows.length).toBeGreaterThan(0);
    expect(windows.some(reRendersAfterClaimsSettle)).toBe(true);
  });

  test("/implement Phase 4 § Milestone Archival carries the post-settle re-render directive", () => {
    const windows = tokenStatsWindows(milestoneArchivalSection());
    expect(windows.length).toBeGreaterThan(0);
    expect(windows.some(reRendersAfterClaimsSettle)).toBe(true);
  });

  test("both sites name the design bucket as where shared-session cost lands", () => {
    for (const body of [specWriteBody(), milestoneArchivalSection()]) {
      const windows = tokenStatsWindows(body);
      expect(
        windows.some(
          (w) =>
            w.includes("design/exploration") &&
            /shared|more than one FR|two FRs|same session|one session/i.test(w),
        ),
      ).toBe(true);
    }
  });
});

// STE-396 AC-STE-396.5 — the milestone ROW-SCOPING gate must admit demoted rows.
//
// The unit tests for AC-STE-396.5 hand the WHOLE ledger to
// `renderMilestoneRollup`, so they never exercise the production path: in
// /ship-milestone § 7 the rows are scoped to the milestone BEFORE the render.
// That scoping rule is prose, and it enumerates exactly two row states —
// "`claimed_by` names an in-scope FR" and "(for unclaimed rows) `git_branch` on
// the milestone's branch lineage". STE-396 introduces a THIRD state: a demoted
// row carrying `claimed_by = design/exploration` (the DESIGN_BUCKET sentinel).
// It names no in-scope FR and it is not unclaimed, so it satisfies neither leg
// and is filtered out before the render ever sees it — dropping demoted cost
// from the milestone total, in direct contradiction of AC-STE-396.5's "the
// milestone `total` row is unchanged in every case — demotion moves rows
// between buckets, never in or out of the total."

/**
 * The row-scoping clause of /ship-milestone § 7, bounded to the scoping rule
 * itself (anchor → the `renderMilestoneRollup` call that consumes its output).
 * Deliberately tight: the design-bucket description later in the same paragraph
 * must NOT be able to satisfy a scoping assertion by proximity.
 */
function milestoneScopingClause(): string {
  const body = shipBody();
  const idx = body.indexOf("scope rows to this milestone");
  expect(idx).toBeGreaterThan(-1);
  const rest = body.slice(idx);
  const end = rest.indexOf("renderMilestoneRollup");
  return end === -1 ? rest.slice(0, 900) : rest.slice(0, end);
}

/**
 * The design/exploration bucket description in /ship-milestone § 7, bounded to
 * the bucket clause (anchor → the next rollup line). Tight so the paragraph's
 * later "sentinel-fenced" mechanics can't satisfy a sentinel-mark assertion.
 */
function designBucketClause(): string {
  const body = shipBody();
  const idx = body.indexOf("design/exploration");
  expect(idx).toBeGreaterThan(-1);
  const rest = body.slice(idx);
  let end = -1;
  for (const marker of [
    "and a milestone `total`",
    "milestone `total`",
    "The block is sentinel-fenced",
  ]) {
    const i = rest.indexOf(marker);
    if (i !== -1 && (end === -1 || i < end)) end = i;
  }
  return end === -1 ? rest.slice(0, 500) : rest.slice(0, end);
}

// A row demoted into the design bucket — by sentinel name or by the act.
const DEMOTED_ROW_RE =
  /design\/exploration|DESIGN_BUCKET|design bucket|demot(?:e|ed|es|ion)/i;

describe("AC-STE-396.5 — the /ship-milestone row-scoping gate admits demoted design-bucket rows", () => {
  test("the scoping rule accounts for the DESIGN_BUCKET sentinel, not just in-scope-FR and unclaimed", () => {
    const clause = milestoneScopingClause();
    // Belonging framing is what the clause decides; unchanged by this AC.
    expect(clause).toMatch(/belongs|in scope|counted|included/i);
    // The third row state must be named, or demoted rows are filtered out
    // before `renderMilestoneRollup` is ever called.
    expect(clause).toMatch(DEMOTED_ROW_RE);
  });

  test("the two-leg enumeration is no longer exhaustive — a sentinel-claimed row is not dropped", () => {
    const clause = milestoneScopingClause();
    // The clause names both pre-existing legs...
    expect(clause).toMatch(/claimed_by/);
    expect(clause).toMatch(/unclaimed|never claimed/i);
    // ...and must not leave a sentinel-claimed row falling through both.
    expect(
      DEMOTED_ROW_RE.test(clause) &&
        /(?:belongs|in scope|counted|included|admit)/i.test(clause),
    ).toBe(true);
  });

  test("the design/exploration bucket is described as holding demoted shared-session rows", () => {
    const clause = designBucketClause();
    expect(clause).toMatch(
      /demot(?:e|ed|es|ion)|shared[- ]session|shared by (?:two|more than one)|more than one FR/i,
    );
  });

  test("the bucket description no longer claims its rows are unmarked brainstorm-only rows", () => {
    const clause = designBucketClause();
    // (a) demoted rows can come from ANY skill, not just `brainstorm`.
    expect(clause).toMatch(
      /any skill|not (?:only|just) `?brainstorm|regardless of (?:which |the )?skill/i,
    );
    // (b) demoted rows DO carry a `claimed_by` mark — the sentinel itself.
    expect(clause).not.toMatch(/no `?claimed_by`? mark/i);
  });
});

// STE-396 AC-STE-396.4 — the /implement operational mirror must carry the
// post-settle second pass too.
//
// docs/implement-reference.md § Phase 4 Milestone Archival states "The skill
// carries the condensed entry; this section is the operational mirror", and
// skills/implement/SKILL.md defers to it for "Full procedure detail". The
// AC-STE-396.4 meta-tests above grep only the two SKILL.md bodies, so the
// FULLER of the two documents can — and currently does — sit stale.

function implementReferenceBody(): string | null {
  return existsSync(implementReferencePath)
    ? readFileSync(implementReferencePath, "utf8")
    : null;
}

/** The `## Phase 4 Milestone Archival` slice of the reference doc. */
function referencePhase4Section(body: string): string {
  const idx = body.indexOf("## Phase 4 Milestone Archival");
  expect(idx).toBeGreaterThan(-1);
  const next = body.slice(idx + 1).search(/\n#{1,2} /);
  return next === -1 ? body.slice(idx) : body.slice(idx, idx + 1 + next);
}

describe("AC-STE-396.4 — docs/implement-reference.md mirrors the post-settle re-render directive", () => {
  test("the reference doc's Phase 4 Token Stats section carries the post-settle second pass", () => {
    const body = implementReferenceBody();
    // Vacuous only if the SKILL.md no longer defers to this reference doc;
    // while the pointer stands, the mirror obligation stands with it.
    if (body === null) {
      expect(implementBody()).not.toContain("docs/implement-reference.md");
      return;
    }
    const section = referencePhase4Section(body);
    const windows = tokenStatsWindows(section);
    expect(windows.length).toBeGreaterThan(0);
    expect(windows.some(reRendersAfterClaimsSettle)).toBe(true);
  });

  test("the mirror names the design bucket as where shared-session cost lands", () => {
    const body = implementReferenceBody();
    if (body === null) {
      expect(implementBody()).not.toContain("docs/implement-reference.md");
      return;
    }
    const windows = tokenStatsWindows(referencePhase4Section(body));
    expect(
      windows.some(
        (w) =>
          w.includes("design/exploration") &&
          /shared|more than one FR|two FRs|same session|one session/i.test(w),
      ),
    ).toBe(true);
  });
});
