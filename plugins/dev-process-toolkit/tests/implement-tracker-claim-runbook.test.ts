import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { rulesBlock } from "./_skill-md";

// STE-101 AC-STE-101.7 — prose-shape gate for the Claim/Release runbook
// rewrite. Same authoring contract as `tests/probe-parity.test.ts` and
// `tests/gate-check-filename-frontmatter-match.test.ts`: read the SKILL.md
// + tracker-mode docs, regex-match the documented contract surface.
//
// Why a prose test instead of a behavioral test: the runbook describes
// what the LLM-as-runtime must do, not what a TS function must do. The
// behavioral assertion is `/gate-check` probe #14 (active-side ticket
// state drift), which already exists. This test locks the documented
// contract so a future SKILL.md edit can't silently strip it.

const pluginRoot = join(import.meta.dir, "..");
const skillPath = join(pluginRoot, "skills", "implement", "SKILL.md");
const trackerModePath = join(pluginRoot, "docs", "implement-tracker-mode.md");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("AC-STE-101.1 — Claim runbook section in docs/implement-tracker-mode.md", () => {
  test("`## Claim runbook` heading exists", () => {
    const body = read(trackerModePath);
    expect(body).toMatch(/^## Claim runbook$/m);
  });

  test("runbook reads ticket via mcp__<tracker>__get_issue", () => {
    const body = read(trackerModePath);
    expect(body).toMatch(/mcp__<tracker>__get_issue/);
  });

  test("runbook documents `claimed` / `already-ours` / `taken-elsewhere` decision branches", () => {
    const body = read(trackerModePath);
    expect(body).toMatch(/already-ours/);
    expect(body).toMatch(/taken-elsewhere/);
    expect(body).toMatch(/claimed/);
  });

  test("runbook routes the transition through the active adapter's `transition_status` row", () => {
    const body = read(trackerModePath);
    expect(body).toMatch(/adapters\/<tracker>\.md/);
    expect(body).toMatch(/transition_status/);
    expect(body).toMatch(/Tool surface/);
  });

  test("runbook references status_mapping[in_progress] for the In Progress hop", () => {
    const body = read(trackerModePath);
    expect(body).toMatch(/status_mapping\[in_progress\]/);
  });

  test("runbook calls out the STE-65 invariant (no Backlog → Done leap)", () => {
    const body = read(trackerModePath);
    expect(body).toMatch(/STE-65/);
  });
});

describe("AC-STE-101.2 — Release runbook section in docs/implement-tracker-mode.md", () => {
  test("`## Release runbook` heading exists", () => {
    const body = read(trackerModePath);
    expect(body).toMatch(/^## Release runbook$/m);
  });

  test("runbook routes to status_mapping[done] via the active adapter's transition_status row", () => {
    const body = read(trackerModePath);
    const release = sliceSection(body, "## Release runbook");
    expect(release).toMatch(/status_mapping\[done\]/);
    expect(release).toMatch(/transition_status/);
  });

  test("runbook performs post-release verify via mcp__<tracker>__get_issue", () => {
    const body = read(trackerModePath);
    const release = sliceSection(body, "## Release runbook");
    expect(release).toMatch(/mcp__<tracker>__get_issue/);
  });

  test("runbook surfaces NFR-10 refusal on silent no-op trap", () => {
    const body = read(trackerModePath);
    const release = sliceSection(body, "## Release runbook");
    expect(release).toMatch(/NFR-10/);
    expect(release.toLowerCase()).toMatch(/silent no-op|no-op trap/);
  });

  test("runbook honors STE-84 idempotent-terminal branch (already-released)", () => {
    const body = read(trackerModePath);
    const release = sliceSection(body, "## Release runbook");
    expect(release).toMatch(/STE-84/);
    expect(release).toMatch(/already-released/);
  });
});

describe("AC-STE-101.8 — Multi-tracker compat: <tracker> placeholder, no hard-coded vendor names", () => {
  test("Claim runbook uses <tracker> placeholder and does not hard-code 'linear' or 'atlassian'", () => {
    const body = read(trackerModePath);
    const claim = sliceSection(body, "## Claim runbook");
    expect(claim).toMatch(/<tracker>/);
    // Vendor-agnostic prose: no mcp__linear__ or mcp__atlassian__ baked in.
    expect(claim).not.toMatch(/mcp__linear__/);
    expect(claim).not.toMatch(/mcp__atlassian__/);
  });

  test("Release runbook uses <tracker> placeholder and does not hard-code 'linear' or 'atlassian'", () => {
    const body = read(trackerModePath);
    const release = sliceSection(body, "## Release runbook");
    expect(release).toMatch(/<tracker>/);
    expect(release).not.toMatch(/mcp__linear__/);
    expect(release).not.toMatch(/mcp__atlassian__/);
  });
});

describe("AC-STE-101.3 — SKILL.md step 0.c references § Claim runbook", () => {
  test("step 0.c text replaces Provider.claimLock reference with a § Claim runbook pointer", () => {
    const body = read(skillPath);
    // The pointer must name both the file and the section.
    expect(body).toMatch(/docs\/implement-tracker-mode\.md.*Claim runbook/);
  });

  test("SKILL.md no longer cites `Provider.claimLock(id, currentBranch)` as the entry-gate API", () => {
    const body = read(skillPath);
    // The abstract API reference must be removed; behavioral semantics survive in the runbook.
    expect(body).not.toMatch(/Provider\.claimLock\(id,\s*currentBranch\)/);
  });
});

describe("AC-STE-101.4 — SKILL.md Phase 4d steps (b) + (c) reference § Release runbook", () => {
  test("Phase 4d step (b) text points at § Release runbook", () => {
    const body = read(skillPath);
    const phase4d = sliceSection(body, "### Phase 4 Close");
    // Both step (b) and step (c) are inside Phase 4 Close. Pointer must name the file + section.
    expect(phase4d).toMatch(/Release runbook/);
    expect(phase4d).toMatch(/docs\/implement-tracker-mode\.md/);
  });

  test("Phase 4d step (c) post-release verification references status_mapping.done", () => {
    const body = read(skillPath);
    const phase4d = sliceSection(body, "### Phase 4 Close");
    // Step (c)'s assertion semantics survive the runbook rewrite.
    expect(phase4d).toMatch(/status_mapping\.done|status_mapping\[done\]/);
  });

  test("Phase 4d no longer cites `Provider.releaseLock(<id>)` or `Provider.getTicketStatus(<id>)` as the API", () => {
    const body = read(skillPath);
    const phase4d = sliceSection(body, "### Phase 4 Close");
    // The headline-API references replaced; the behavioral semantics moved to the runbook.
    expect(phase4d).not.toMatch(/`Provider\.releaseLock\(<id>\)`/);
    expect(phase4d).not.toMatch(/`Provider\.getTicketStatus\(<id>\)`/);
  });
});

describe("AC-STE-101.5 — Phase 1-exit self-check step (claim verification)", () => {
  test("SKILL.md adds a Phase 1-exit step that re-fetches via mcp__<tracker>__get_issue", () => {
    const body = read(skillPath);
    const verify = step0eVerifySection(body);
    expect(verify).toMatch(/Claim verification/i);
    expect(verify).toMatch(/mcp__<tracker>__get_issue/);
  });

  test("self-check asserts state == status_mapping[in_progress] AND assignee == currentUser", () => {
    const body = read(skillPath);
    const verify = step0eVerifySection(body);
    expect(verify).toMatch(/status_mapping\[in_progress\]/);
    expect(verify).toMatch(/assignee\s*==\s*currentUser/);
  });

  test("self-check refuses with NFR-10 canonical shape on mismatch", () => {
    const body = read(skillPath);
    const verify = step0eVerifySection(body);
    expect(verify).toMatch(/NFR-10/);
    expect(verify.toLowerCase()).toMatch(/refus|hard-?refus/);
  });

  test("self-check is mode-gated: `mode: none` skips it (LocalProvider sentinel makes it vacuous)", () => {
    const body = read(skillPath);
    const verify = step0eVerifySection(body);
    expect(verify.toLowerCase()).toMatch(/mode:\s*none|mode none|local-no-tracker/);
  });
});

describe("AC-STE-101.6 — Forbidden-rule prose rewritten to the concrete Claim/Release runbook shape", () => {
  test("rule states tracker writes during /implement are exactly the Claim and Release runbook calls", () => {
    const body = read(skillPath);
    const rules = rulesBlock(body);
    expect(rules).toMatch(/Tracker writes during \/implement are exactly the calls in the Claim and Release runbooks/);
  });

  test("rule still forbids arbitrary mid-flow tracker writes (AC toggles outside STE-17, etc.)", () => {
    const body = read(skillPath);
    const rules = rulesBlock(body);
    expect(rules).toMatch(/STE-17/);
    expect(rules.toLowerCase()).toMatch(/forbidden|are forbidden/);
  });

  test("rule cross-references both runbooks", () => {
    const body = read(skillPath);
    const rules = rulesBlock(body);
    expect(rules).toMatch(/Claim.*runbook/i);
    expect(rules).toMatch(/Release.*runbook/i);
  });
});

// --- Helpers ---

// Slice the SKILL.md "0.e Claim verification" sub-bullet content. Anchors at the
// bullet header and stops at the next top-level numbered list item (`1. `),
// which is `1. **Check for specs**` — the boundary between Phase 1's step 0
// sub-bullets and the rest of Phase 1. Robust against the bullet's content
// growing or shrinking, unlike a fixed character window.
function step0eVerifySection(body: string): string {
  const start = body.indexOf("0.e Claim verification");
  expect(start).toBeGreaterThan(-1);
  const end = body.indexOf("\n1. **Check for specs**", start);
  expect(end).toBeGreaterThan(start);
  return body.slice(start, end);
}

function sliceSection(body: string, heading: string): string {
  const start = body.indexOf(heading);
  expect(start).toBeGreaterThan(-1);
  // Detect the heading depth (count leading '#') and end at the next heading at the same or shallower depth.
  const headingMatch = heading.match(/^#+/);
  const depth = headingMatch ? headingMatch[0].length : 2;
  const remainder = body.slice(start + heading.length);
  // Match a heading whose hash count is <= depth.
  const stopRe = new RegExp(`\\n#{1,${depth}} \\S`);
  const endRel = remainder.search(stopRe);
  return endRel === -1 ? body.slice(start) : body.slice(start, start + heading.length + endRel);
}
