// STE-736 (M_b2fdc0) — AC-STE-736.1, /implement half (fix round 1, review I2).
//
// `rewriteArchivedPlan` leaves alone any link that still resolves, so the
// archival caller must move each FR (and the plan) into its archive folder
// BEFORE calling `rewriteArchiveLinks`. If a rewrite ever runs first, the links
// silently stay unrewritten. This file pins that order in /implement's prose,
// in both homes, and pins a comment at the helper saying so.
//
// Legs:
//   1. skills/implement/SKILL.md § Milestone Archival "Procedure summary":
//      FR `git mv` < plan `git mv` < first `rewriteArchiveLinks`, and the
//      sentence carrying the rewrite says it runs after the FR and plan moves.
//   2. docs/implement-reference.md § Milestone Archival Procedure (lettered
//      sub-steps): names the rewrite, after both moves.
//   3. docs/implement-reference.md § Phase 4 Milestone Archival — full
//      procedure detail: same order, same explicit "after the moves" sentence.
//   4. adapters/_shared/src/spec_archive/rewrite_links.ts: the comment directly
//      above `rewriteArchiveLinks` and above `rewriteArchivedPlan` says the
//      caller must move the FR and the plan first, because a link that still
//      resolves is left alone.
//
// Lock-release order is NOT pinned here (another FR owns it). No leg requires
// the implement SKILL.md to grow (cap 358).

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PLUGIN_ROOT } from "./_m_b2fdc0_ste736_fixture";

const SKILL = join(PLUGIN_ROOT, "skills", "implement", "SKILL.md");
const REF = join(PLUGIN_ROOT, "docs", "implement-reference.md");
const HELPER = join(PLUGIN_ROOT, "adapters", "_shared", "src", "spec_archive", "rewrite_links.ts");

function slice(doc: string, start: string, end: string, where: string): string {
  const a = doc.indexOf(start);
  const b = a < 0 ? -1 : doc.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`section ${start} .. ${end} not found in ${where}`);
  return doc.slice(a, b);
}

const FR_MV = /git mv specs\/frs\/<name> specs\/frs\/archive\/<name>/;
const PLAN_MV = /git mv specs\/plan\/<M#>\.md specs\/plan\/archive\/<M#>\.md/;
const REWRITE = /rewriteArchiveLinks/;

function offsets(section: string): { frMove: number; planMove: number; rewrite: number } {
  return {
    frMove: section.search(FR_MV),
    planMove: section.search(PLAN_MV),
    rewrite: section.search(REWRITE),
  };
}

/** The sentence around the first `rewriteArchiveLinks` mention (". " delimited; code spans carry no ". "). */
function rewriteSentence(section: string): string {
  const i = section.search(REWRITE);
  if (i < 0) return "";
  const a = section.lastIndexOf(". ", i);
  const b = section.indexOf(". ", i);
  return section.slice(a < 0 ? 0 : a + 2, b < 0 ? section.length : b);
}

/** Does the sentence say the rewrite runs after (once) the FR and plan moves? */
function statesAfterMoves(sentence: string): boolean {
  return (
    /\b(after|once)\b/i.test(sentence) &&
    /\bFRs?\b/.test(sentence) &&
    /\bplans?\b/i.test(sentence) &&
    /\b(mov(e|es|ed)|git mv)\b/i.test(sentence)
  );
}

function expectOrder(section: string): void {
  const o = offsets(section);
  expect({ frMove: o.frMove >= 0, planMove: o.planMove >= 0, rewrite: o.rewrite >= 0 }).toEqual({
    frMove: true,
    planMove: true,
    rewrite: true,
  });
  expect({ frMoveBeforeRewrite: o.frMove < o.rewrite, planMoveBeforeRewrite: o.planMove < o.rewrite }).toEqual({
    frMoveBeforeRewrite: true,
    planMoveBeforeRewrite: true,
  });
}

describe("AC-STE-736.1 — /implement milestone archival moves FRs and the plan before rewriting links", () => {
  const skill = readFileSync(SKILL, "utf-8");
  const ref = readFileSync(REF, "utf-8");
  const summary = slice(skill, "**Procedure summary.**", "Full procedure detail:", "implement SKILL.md");
  const lettered = slice(ref, "## Milestone Archival Procedure", "## Decision matrix", "implement-reference.md");
  const detail = slice(
    ref,
    "## Phase 4 Milestone Archival — full procedure detail",
    "## Step 14 Verification Evidence",
    "implement-reference.md",
  );

  test("SKILL.md Procedure summary: FR git mv and plan git mv come before the first rewriteArchiveLinks", () => {
    expectOrder(summary);
  });

  test("SKILL.md Procedure summary: the rewriteArchiveLinks sentence says it runs after the FR and plan moves", () => {
    const s = rewriteSentence(summary);
    expect({ sentence: s, statesAfterMoves: statesAfterMoves(s) }).toEqual({ sentence: s, statesAfterMoves: true });
  });

  test("implement-reference § Milestone Archival Procedure: names rewriteArchiveLinks after both moves", () => {
    expectOrder(lettered);
  });

  test("implement-reference § Milestone Archival Procedure: the rewrite step says it runs after the FR and plan moves", () => {
    const s = rewriteSentence(lettered);
    expect({ sentence: s, statesAfterMoves: statesAfterMoves(s) }).toEqual({ sentence: s, statesAfterMoves: true });
  });

  test("implement-reference § Phase 4 full procedure detail: FR and plan git mv come before rewriteArchiveLinks", () => {
    expectOrder(detail);
  });

  test("implement-reference § Phase 4 full procedure detail: the rewrite sentence says it runs after the FR and plan moves", () => {
    const s = rewriteSentence(detail);
    expect({ sentence: s, statesAfterMoves: statesAfterMoves(s) }).toEqual({ sentence: s, statesAfterMoves: true });
  });
});

/** The contiguous comment block (JSDoc or // lines) directly above `marker`. */
function commentAbove(src: string, marker: RegExp): string {
  const lines = src.split("\n");
  const at = lines.findIndex((l) => marker.test(l));
  if (at < 0) throw new Error(`${marker} not found in rewrite_links.ts`);
  const out: string[] = [];
  for (let i = at - 1; i >= 0; i--) {
    const t = lines[i]!.trim();
    if (t.startsWith("//") || t.startsWith("/*") || t.startsWith("*") || t.endsWith("*/")) out.unshift(t);
    else break;
  }
  return out.join(" ");
}

function statesCallerContract(comment: string): Record<string, boolean> {
  return {
    saysBefore: /\bbefore\b/i.test(comment),
    namesMove: /\b(mov(e|es|ed)|git mv)\b/i.test(comment),
    namesFR: /\bFRs?\b/.test(comment),
    namesPlan: /\bplans?\b/i.test(comment),
    saysResolvingLinkLeftAlone: /\bresolv(e|es|ing)\b/i.test(comment) && /\b(left|leaves?|untouched|alone|unchanged)\b/i.test(comment),
  };
}

const ALL_TRUE = {
  saysBefore: true,
  namesMove: true,
  namesFR: true,
  namesPlan: true,
  saysResolvingLinkLeftAlone: true,
};

describe("AC-STE-736.1 / review I2 — rewrite_links.ts states the caller's move-first contract", () => {
  const src = readFileSync(HELPER, "utf-8");

  test("comment above rewriteArchiveLinks: caller moves the FR and the plan BEFORE calling (resolving links are left alone)", () => {
    const c = commentAbove(src, /^export function rewriteArchiveLinks\(/);
    expect({ comment: c, ...statesCallerContract(c) }).toEqual({ comment: c, ...ALL_TRUE });
  });

  test("comment above rewriteArchivedPlan: caller moves the FR and the plan BEFORE calling (resolving links are left alone)", () => {
    const c = commentAbove(src, /^function rewriteArchivedPlan\(/);
    expect({ comment: c, ...statesCallerContract(c) }).toEqual({ comment: c, ...ALL_TRUE });
  });
});
