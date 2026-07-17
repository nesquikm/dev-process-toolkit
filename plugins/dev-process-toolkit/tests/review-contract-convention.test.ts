// STE-387 — Review contract: the human approves Summary + Requirement + ACs;
// Technical Design + Testing are implementation-facing and owned by the
// deterministic gates + the TDD audit.
//
// Convention meta-test in the STE-341 → STE-345 → STE-385 lineage:
// readFileSync the shipped prose surface, pin the required contract
// components at every human-approval touchpoint. The canonical sentence
// (adapted per site, meaning fixed): "Review surface: the human approves the
// Summary, Requirement, and Acceptance Criteria; Technical Design and
// Testing are implementation-facing and are verified by the deterministic
// gates and the TDD audit."
//
// AC map:
//   AC-STE-387.1 — /spec-write § 0b step 4 states the contract in the gap
//                  between the `Approve and proceed?` prompt sentence and
//                  the marker-mechanics paragraphs.
//   AC-STE-387.2 — § 4 and the ## Rules draft-approval rule each carry the
//                  contract; § 5's "just like step 4" pointer survives
//                  unchanged.
//   AC-STE-387.3 — docs/sdd-methodology.md gains the spec-time review scope
//                  (sibling to the implementation-time human-review section
//                  or a Key Principles entry) — same partition, same
//                  ownership statement.
//   AC-STE-387.4 — docs/workflow-overview.md gate table: the FR-draft gate
//                  row names the review surface.
//   AC-STE-387.5 — templates/CLAUDE.md.template carries one reviewer-facing
//                  contract bullet; templates namespace guarantee holds.
//   AC-STE-387.6 — calibration: new prose token-free at every surface,
//                  skills STE-token ceiling pinned at 246 at both sites,
//                  SKILL line-cap pin sites agree and spec-write fits with
//                  the contract landed.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pluginRoot = join(import.meta.dir, "..");

const specWritePath = join(pluginRoot, "skills", "spec-write", "SKILL.md");
const methodologyPath = join(pluginRoot, "docs", "sdd-methodology.md");
const overviewPath = join(pluginRoot, "docs", "workflow-overview.md");
const templatePath = join(pluginRoot, "templates", "CLAUDE.md.template");
const nfrLengthTestPath = join(pluginRoot, "tests", "skill-nfr-1-length.test.ts");
const m104DuplicatePinPath = join(
  pluginRoot,
  "tests",
  "m104-ste-383-dpt-gitignore.test.ts",
);
const shippedProseTestPath = join(
  pluginRoot,
  "tests",
  "shipped-prose-no-internal-namespace.test.ts",
);
const templatesNamespaceTestPath = join(
  pluginRoot,
  "tests",
  "templates-no-internal-namespace.test.ts",
);

function read(path: string): string {
  return readFileSync(path, "utf8");
}

/** Slice § 0b (FR creation path) out of /spec-write SKILL.md. */
function specWriteSection0b(body: string): string {
  const start = body.indexOf("### 0b. FR creation path");
  const end = body.indexOf("### 1. Assess current state");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return body.slice(start, end);
}

/** Slice an arbitrary [startNeedle, endNeedle) region; asserts both exist. */
function sliceBetween(
  haystack: string,
  startNeedle: string,
  endNeedle: string,
): string {
  const start = haystack.indexOf(startNeedle);
  expect(start, `missing start anchor: ${startNeedle}`).toBeGreaterThan(-1);
  const end = haystack.indexOf(endNeedle, start);
  expect(end, `missing end anchor: ${endNeedle}`).toBeGreaterThan(start);
  return haystack.slice(start, end);
}

/** All fixed-radius windows around each occurrence of `needle`. */
function windowsAround(
  haystack: string,
  needle: string,
  radius: number,
): string[] {
  const out: string[] = [];
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    out.push(
      haystack.slice(Math.max(0, idx - radius), idx + needle.length + radius),
    );
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return out;
}

/**
 * Full review-contract component matcher (case-sensitive on the section
 * names — they are proper section titles in the canonical sentence):
 * the human-approved trio, the implementation-facing pair, and the
 * gates + audit ownership statement.
 */
function statesReviewContract(text: string): boolean {
  return (
    /Summary/.test(text) &&
    /Requirement/.test(text) &&
    /Acceptance Criteria/.test(text) &&
    /Technical Design/.test(text) &&
    /Testing/.test(text) &&
    /implementation[\s-]facing/i.test(text) &&
    /gates?/i.test(text) &&
    /audit/i.test(text)
  );
}

/** Lighter "names the review surface" matcher for compact table rows. */
function namesReviewSurface(text: string): boolean {
  return (
    /Summary/.test(text) &&
    /Requirement/.test(text) &&
    /(?:Acceptance Criteria|\bACs?\b)/.test(text)
  );
}

const INTERNAL_TOKEN_RE = /\bSTE-\d+\b/;

/** The § 0b step-4 gap: after the approval prompt, before marker mechanics. */
function draftGateGap(): string {
  const sec0b = specWriteSection0b(read(specWritePath));
  return sliceBetween(sec0b, "Approve and proceed?", "**Marker-detection");
}

// ---------------------------------------------------------------------------
// AC-STE-387.1 — draft gate (§ 0b step 4)
// ---------------------------------------------------------------------------

describe("AC-STE-387.1 — § 0b step 4 states the review contract after the approval prompt", () => {
  test("the contract sits between the `Approve and proceed?` prompt and the marker-mechanics paragraphs", () => {
    const gap = draftGateGap();
    expect(
      statesReviewContract(gap),
      "§ 0b step 4 must state the review contract (Summary + Requirement + Acceptance Criteria approved by the human; Technical Design + Testing implementation-facing, verified by gates + audit) directly after the approval prompt, before **Marker-detection",
    ).toBe(true);
  });

  test("the draft-gate contract prose is token-free (no internal tracker-ID literals)", () => {
    expect(draftGateGap()).not.toMatch(INTERNAL_TOKEN_RE);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-387.2 — § 4 + ## Rules carry the contract; § 5 pointer inherits
// ---------------------------------------------------------------------------

describe("AC-STE-387.2 — § 4 and the ## Rules draft-approval rule carry the same contract", () => {
  test("§ 4 Review and confirm states the review contract", () => {
    const sec4 = sliceBetween(
      read(specWritePath),
      "### 4. Review and confirm",
      "### 5. Cross-check consistency",
    );
    expect(
      statesReviewContract(sec4),
      "§ 4 must carry the review contract in one sentence",
    ).toBe(true);
  });

  test("the ## Rules draft-approval rule carries the contract (co-located with 'Present drafts for approval')", () => {
    const body = read(specWritePath);
    const rulesIdx = body.indexOf("\n## Rules");
    expect(rulesIdx).toBeGreaterThan(-1);
    const rules = body.slice(rulesIdx);

    // The draft-approval rule itself survives.
    expect(rules).toContain("Present drafts for approval");

    // The contract is stated by / adjacent to that rule.
    const wins = windowsAround(rules, "Present drafts for approval", 500);
    expect(wins.length).toBeGreaterThan(0);
    expect(
      wins.some((w) => statesReviewContract(w)),
      "the ## Rules draft-approval rule must carry the review contract",
    ).toBe(true);
  });

  test("§ 5's 'just like step 4' pointer survives unchanged (inherits the contract)", () => {
    const sec5 = sliceBetween(
      read(specWritePath),
      "### 5. Cross-check consistency",
      "### 6. Risk scan",
    );
    expect(sec5).toContain("just like step 4");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-387.3 — methodology gains the spec-time review scope
// ---------------------------------------------------------------------------

describe("AC-STE-387.3 — sdd-methodology.md states the spec-time review scope", () => {
  test("the doc carries the same partition + ownership statement (sibling section or Key Principles entry)", () => {
    const doc = read(methodologyPath);

    // Anchor on the human-approved trio's opening member: the doc carries no
    // capital-S "Summary" today, so any hit is the new prose.
    const wins = windowsAround(doc, "Summary", 900);
    expect(
      wins.length,
      "sdd-methodology.md must gain spec-time review-scope prose naming the Summary",
    ).toBeGreaterThan(0);
    expect(
      wins.some((w) => statesReviewContract(w)),
      "the spec-time review scope must state the same partition (Summary + Requirement + Acceptance Criteria vs Technical Design + Testing) with the same gates + audit ownership",
    ).toBe(true);
  });

  test("the implementation-time human-review section survives as the sibling", () => {
    const doc = read(methodologyPath);
    expect(doc).toContain("Human Review Is Required");
    expect(doc).toContain("## Key Principles");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-387.4 — workflow-overview gate table names the review surface
// ---------------------------------------------------------------------------

/** The FR-draft gate row(s) of the Loops & evals reference table. */
function draftGateRows(): string[] {
  const doc = read(overviewPath);
  const section = sliceBetween(
    doc,
    "## Loops & evals reference",
    "## Artifact write-points reference",
  );
  return section
    .split("\n")
    .filter((l) => l.trim().startsWith("|"))
    .filter((l) => /draft/i.test(l));
}

describe("AC-STE-387.4 — workflow-overview FR-draft gate row names the review surface", () => {
  test("a draft-gate table row names Summary + Requirement + ACs", () => {
    const rows = draftGateRows();
    expect(rows.length).toBeGreaterThan(0);
    expect(
      rows.some((r) => namesReviewSurface(r)),
      "the FR-draft gate row in the Loops & evals table must name the review surface (Summary + Requirement + ACs)",
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-387.5 — consumer template carries one reviewer-facing bullet
// ---------------------------------------------------------------------------

describe("AC-STE-387.5 — templates/CLAUDE.md.template carries the reviewer-facing contract bullet", () => {
  test("one bullet states the contract", () => {
    const template = read(templatePath);

    // A bullet line opens the contract (Summary + Requirement on the bullet
    // line itself; the template carries no capital-S Summary today).
    const bullet = template
      .split("\n")
      .find((l) => /^\s*-\s/.test(l) && /Summary/.test(l) && /Requirement/.test(l));
    expect(
      bullet,
      "template must carry a reviewer-facing bullet naming the review surface",
    ).toBeDefined();

    // The bullet's neighborhood states the full contract.
    const idx = template.indexOf(bullet!);
    const win = template.slice(
      Math.max(0, idx - 100),
      idx + bullet!.length + 500,
    );
    expect(
      statesReviewContract(win),
      "the template bullet must state the full contract (trio approved; Technical Design + Testing implementation-facing, gates + audit verified)",
    ).toBe(true);
  });

  test("the templates namespace guarantee holds (no internal STE-N / M-N literals, fenced code stripped)", () => {
    const template = read(templatePath);
    const stripped = template.replace(/```[\s\S]*?```/g, "");
    expect(stripped.match(/\b(?:STE-|M)\d+\b/g)).toBeNull();

    // The existing namespace test is unmodified in scope: it still targets
    // the consumer template.
    expect(read(templatesNamespaceTestPath)).toContain(
      "templates/CLAUDE.md.template",
    );
  });
});

// ---------------------------------------------------------------------------
// AC-STE-387.6 — calibration rides this FR
// ---------------------------------------------------------------------------

describe("AC-STE-387.6 — calibration: token-free prose, ceiling 245, line-cap pin sites agree", () => {
  test("every new contract surface exists and is token-free", () => {
    const surfaces: string[] = [];

    // § 0b step-4 gap (the whole gap is contract-bearing once landed).
    const gap = draftGateGap();
    if (statesReviewContract(gap)) surfaces.push(gap);

    // Workflow-overview draft-gate row(s) naming the surface.
    for (const row of draftGateRows()) {
      if (namesReviewSurface(row)) surfaces.push(row);
    }

    // Methodology contract window.
    for (const w of windowsAround(read(methodologyPath), "Summary", 900)) {
      if (statesReviewContract(w)) surfaces.push(w);
    }

    // Template contract bullet.
    for (const l of read(templatePath).split("\n")) {
      if (/^\s*-\s/.test(l) && /Summary/.test(l) && /Requirement/.test(l)) {
        surfaces.push(l);
      }
    }

    // All four insertion surfaces landed…
    expect(
      surfaces.length,
      "contract prose must exist at the spec-write gap, the workflow-overview row, the methodology doc, and the template",
    ).toBeGreaterThanOrEqual(4);
    // …and none of them carries an internal tracker-ID token.
    for (const s of surfaces) {
      expect(s).not.toMatch(INTERNAL_TOKEN_RE);
    }
  });

  test("both SKILL line-cap pin sites agree and spec-write (with the contract landed) fits under the cap", () => {
    // Pin site 1: the NFR-1 loop test.
    const nfrSrc = read(nfrLengthTestPath);
    const capMatch = /const SKILL_LINE_CAP = (\d+);/.exec(nfrSrc);
    expect(capMatch).not.toBeNull();
    const cap = Number(capMatch![1]);

    // Pin site 2: the M104 duplicate pin (title number + assertion literal).
    const m104Src = read(m104DuplicatePinPath);
    const dupMatch = /NFR-1 line cap \((\d+)\)/.exec(m104Src);
    expect(dupMatch).not.toBeNull();
    expect(Number(dupMatch![1])).toBe(cap);
    expect(m104Src).toContain(`toBeLessThanOrEqual(${cap})`);

    // The cap this FR sizes must accommodate the new sentences: spec-write
    // carries the contract at the draft gate AND fits under the shared cap.
    const specWrite = read(specWritePath);
    expect(statesReviewContract(draftGateGap())).toBe(true);
    expect(specWrite.split("\n").length).toBeLessThanOrEqual(cap);
  });

  test("the skills STE-token ceiling stays pinned at 246 at both sites", () => {
    const src = read(shippedProseTestPath);
    const m = /skills:\s*(\d+),/.exec(src);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(246);

    expect(read(m104DuplicatePinPath)).toContain("toBeLessThanOrEqual(246)");
  });
});
