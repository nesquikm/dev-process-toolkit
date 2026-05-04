import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { specWriteStep7Map } from "./_skill-md";

// STE-213 — /spec-write FR-draft acceptance gate default-apply under
// Auto mode / `-p`. Symmetric carve-out of the existing
// `spec_write_commit_default_applied` contract that already governs the
// downstream commit gate (STE-179). The FR-draft gate ("Approve and
// proceed?") has no such carve-out, so a `claude -p /spec-write …` run
// stops mid-flow at the draft prompt — discovered in 2026-05-04 Jira
// smoke Run B v2.7.0 (B-F1).
//
// `/spec-write` is an LLM-driven skill; the SKILL.md prose IS the
// contract. These tests assert the SKILL.md carries the right
// instructions so the LLM produces:
//   AC.1: Auto mode / -p default-applies `y` at the draft gate
//   AC.2: spec_write_draft_default_applied capability key in static map
//   AC.3: Interactive y/n/edit preserved; no row on interactive y
//   AC.4: Row emits in Step 7 closing summary
//   AC.5: spec_write_draft_declined for the interactive n decline
//   AC.6: Driver-side smoke regression — out of unit-test scope; covered
//         by `/smoke-test` next run.

const pluginRoot = join(import.meta.dir, "..");
const skillPath = join(pluginRoot, "skills", "spec-write", "SKILL.md");

function read(): string {
  return readFileSync(skillPath, "utf8");
}

describe("AC-STE-213.1 — FR-draft gate default-applies y under Auto mode / -p", () => {
  test("SKILL.md documents the Auto-mode / -p default-apply rule for the FR-draft gate", () => {
    const body = read();
    // Anchor on the canonical token combination: "draft" + "default-apply"
    // + "Auto mode" / "-p". The commit-gate prose already carries
    // "Auto mode" / "-p"; the draft-gate prose must mirror it.
    expect(body).toMatch(/draft[\s-]?(?:gate|acceptance)/i);
    expect(body).toMatch(/Auto mode|-p|non-interactive/);
    // Must explicitly name the default-apply behavior on the draft path.
    const draftBlock = body.match(/draft[\s\S]{0,400}?default[-\s]?appl(?:y|ies|ied)/i);
    expect(draftBlock).not.toBeNull();
  });

  test("the draft default-apply prose mirrors the commit-gate carve-out shape", () => {
    const body = read();
    // The two carve-outs should sit close together so a future reader sees
    // both auto-apply contracts side-by-side.
    expect(body).toMatch(/spec_write_draft_default_applied/);
    expect(body).toMatch(/spec_write_commit_default_applied/);
  });
});

describe("AC-STE-213.2 — spec_write_draft_default_applied row in the static map", () => {
  test("the canonical key is present in the static plain-language map", () => {
    const map = specWriteStep7Map(read());
    expect(map).toMatch(/\| `spec_write_draft_default_applied` \|/);
  });

  test("the rendered prose mentions auto-approval and the verify-via-FR-file follow-up check", () => {
    const map = specWriteStep7Map(read());
    expect(map).toMatch(/auto[- ]approved/i);
    // The draft-gate row directs the operator to verify the *draft itself*
    // (not a commit diff like the commit-gate row).
    expect(map).toMatch(/specs\/frs\/|verify.*draft|FR file/i);
  });
});

describe("AC-STE-213.3 — interactive runs preserve y / n / edit; no row on interactive y", () => {
  test("Step 7a or the draft-gate paragraph documents the y / n / edit interactive prompt", () => {
    const body = read();
    expect(body).toMatch(/y\s*\/\s*n\s*\/\s*edit/i);
  });

  test("the row is documented as emit-on-auto-apply only (not on interactive y)", () => {
    const body = read();
    // Same conditional-emit shape as spec_write_commit_default_applied.
    const draftRowContext = body.match(/spec_write_draft_default_applied[\s\S]{0,400}/);
    expect(draftRowContext).not.toBeNull();
    expect(body).toMatch(
      /(?:auto-apply|auto[-\s]?applied|quiet[-\s]?mode|fires only when|only when (?:auto|the))/i,
    );
  });
});

describe("AC-STE-213.4 — row emits in Step 7 closing summary alongside commit-default-applied row", () => {
  test("the static map's two auto-apply rows sit next to each other", () => {
    const map = specWriteStep7Map(read());
    // The two rows should be adjacent — co-located so operators see both
    // auto-apply contracts on every quiet-mode run.
    const draftIdx = map.indexOf("spec_write_draft_default_applied");
    const commitIdx = map.indexOf("spec_write_commit_default_applied");
    expect(draftIdx).toBeGreaterThan(-1);
    expect(commitIdx).toBeGreaterThan(-1);
    // The two rows live in the same static map — adjacency is enforced by
    // the row-line offset being small (single intermediate row at most).
    const between = map.slice(
      Math.min(draftIdx, commitIdx),
      Math.max(draftIdx, commitIdx),
    );
    // Allow at most ~2 intermediate `|` row lines between the two auto-apply
    // rows; tighter than that risks tripping on minor reorderings, looser
    // than that defeats the co-location intent.
    const intermediateRowCount = (between.match(/\n\| `/g) ?? []).length;
    expect(intermediateRowCount).toBeLessThanOrEqual(2);
  });
});

describe("AC-STE-213.5 — spec_write_draft_declined row in the static map", () => {
  test("the canonical key is present in the static map", () => {
    const map = specWriteStep7Map(read());
    expect(map).toMatch(/\| `spec_write_draft_declined` \|/);
  });

  test("the rendered prose names the decline outcome and the retry path", () => {
    const map = specWriteStep7Map(read());
    // The decline row tells the operator that no FR file was written and
    // they must re-invoke /spec-write to retry.
    const draftDeclineMatch = map.match(/spec_write_draft_declined[\s\S]{0,300}/);
    expect(draftDeclineMatch).not.toBeNull();
    const draftDeclineSlice = draftDeclineMatch?.[0] ?? "";
    expect(draftDeclineSlice).toMatch(/declin(?:e|ed)/i);
    expect(draftDeclineSlice).toMatch(/files? not written|not written|re-invoke|retry/i);
  });
});

describe("AC-STE-213.6 — smoke-regression coverage note", () => {
  // The full integration test (a `claude -p /spec-write …` invocation
  // against a throwaway test project) lives in the smoke-test driver
  // (out-of-repo) — the next 2026-05-* Linear/Jira smoke run is the
  // regression guard. This test pins the SKILL.md prose so the skill
  // produces the right behavior; the smoke driver verifies end-to-end.
  test("SKILL.md prose carries enough detail for the smoke regression to bind to", () => {
    const body = read();
    // The smoke driver's `claude -p /spec-write …` run greps for both
    // capability keys in the captured stdout. SKILL.md must instruct the
    // LLM to emit both rows on the auto-apply path.
    expect(body).toMatch(/spec_write_draft_default_applied/);
    expect(body).toMatch(/spec_write_commit_default_applied/);
  });
});
