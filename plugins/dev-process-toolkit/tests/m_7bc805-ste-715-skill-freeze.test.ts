// STE-715 (M_7bc805) AC.18 — line guards for skills/tdd/SKILL.md and
// skills/spec-review/SKILL.md against their v3.0.0 bytes.
//
// Neither file had a line freeze before this FR. This is a `driftBeyond`-style
// check in the AC-STE-618.8 shape: the v3.0.0 bytes are pinned by their sha256
// (a literal, verified against the v3.0.0 merge commit), and today's file must
// equal them once the outcome lines this FR adds are taken out. So any other
// new instruction — a Read, a Grep, a reworded line — is drift, which a model
// of `bun run` calls alone cannot see.
//
// Amended by AC-STE-738.3 (operator ruling 2026-11-11), which amends
// AC-STE-715.18 by name for skills/tdd/SKILL.md only: PR #121's defect check,
// stranded-plant sweep, resume points and halt rows live in the orchestrator's
// own instructions, so no reshaping of that PR passes a one-added-line guard.
// The tdd freeze is re-based to the file's post-change digest — any one other
// changed line still reads as drift. spec-review's guard is untouched.
//
// Amended by AC-STE-774.4 (M_4daa6e): each file carries one STE-774 record
// sentence gated on `review_findings: on`, admitted by its exact bytes — a
// whole added line in spec-review (beside the outcome line), and an exact
// in-line sentence in tdd's § 5 AUDIT parse paragraph, taken out before the
// AC-STE-738.3 digest is compared. The digest pin itself does not move.

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PLUGIN_REL, PLUGIN_ROOT, atV300 } from "./_m_7bc805_gate_outcome_fixture";

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

/** The v3.0.0 (6c62b32c) bytes of each guarded file, pinned by digest, and the outcome lines this FR adds. */
const GUARDED: Record<string, { v300Sha256: string; addedLines: number }> = {
  tdd: { v300Sha256: "437ef7034c03ab2c0225a19f87a4360a0684318334972559fd1f6936897c6ef2", addedLines: 1 },
  "spec-review": { v300Sha256: "6bcfb014120363c9ca957caef899be59a851ba3da963ed80f757fcb036528498", addedLines: 1 },
};

// Amended by AC-STE-774.4 (M_4daa6e): the exact STE-774 lines each guarded file admits.
/** skills/spec-review/SKILL.md step 1: one whole added line, after the outcome line. */
const SPEC_REVIEW_STE774_LINE =
  '   Only if that receipt call also printed `review_findings: on`, after the audit result is parsed write the fork\'s full output to a temp file and record its counts with `bun run "${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/review_findings_receipt.ts" record "<that checkout root>" spec-review "<that file>"`.';
/** skills/tdd/SKILL.md § 5 AUDIT: one sentence inserted into the parse paragraph. */
const TDD_STE774_SENTENCE =
  ' Only if the § 1 receipt call also printed `review_findings: on`, write the fork\'s full output to a temp file and record its counts with `bun run "${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/review_findings_receipt.ts" record "<that checkout root>" tdd-audit "<that file>"` once per audit.';
/** The admitted STE-774 lines per line-guarded skill. */
const STE774_LINES: Record<string, number> = { "spec-review": 1 };

/** The skills AC-STE-715.18's v3.0.0-plus-outcome-line guard still applies to. */
const LINE_GUARDED: ReadonlyArray<string> = ["spec-review"];

/**
 * AC-STE-738.3 amends AC-STE-715.18: skills/tdd/SKILL.md is pinned at its
 * post-change digest. The reason is recorded with the pin.
 */
const TDD_REBASE = {
  amends: "AC-STE-715.18",
  by: "AC-STE-738.3",
  reason:
    "PR #121 puts its defect check, stranded-plant sweep, resume points and halt rows in the orchestrator's own instructions; " +
    "the operator ruled (2026-11-11) to re-base the tdd freeze at the post-change digest rather than widen the line guard",
  sha256: "6012ecf504e9741c00b0db3ee86b31998bea5f76a464db95779673ede92214f1",
} as const;

/** The guard after the re-base: drift is any byte that moves the digest. */
function driftFromRebase(text: string): string[] {
  // Amended by AC-STE-774.4 (M_4daa6e): the STE-774 sentence, carried exactly once, is taken out first.
  const parts = text.split(TDD_STE774_SENTENCE);
  if (parts.length !== 2) return [`skills/tdd/SKILL.md carries the AC-STE-774.4 sentence ${parts.length - 1} times, not once`];
  const base = parts.join("");
  return sha(base) === TDD_REBASE.sha256 ? [] : [`skills/tdd/SKILL.md digest ${sha(base)} ≠ pinned ${TDD_REBASE.sha256}`];
}

const OUTCOME_ORDER = 'bun run "${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/gate_receipt.ts" outcome';

/** A line this FR may add: it orders the outcome verb and names the `outcome: on` condition. */
function isOutcomeLine(line: string): boolean {
  return line.includes(OUTCOME_ORDER) && line.includes("`outcome: on`");
}

/**
 * The guard. Returns every drift beyond the permitted added outcome lines,
 * named by the v3.0.0 line it sits at, plus the count of added outcome lines.
 */
// Amended by AC-STE-774.4 (M_4daa6e): also counts, and takes out, the exact STE-774 line (`ste774`).
function driftBeyondOutcomeLines(before: string, after: string): { drift: string[]; added: number; ste774: number } {
  const a = before.split("\n");
  const kept: string[] = [];
  let added = 0;
  let ste774 = 0;
  for (const line of after.split("\n")) {
    if (isOutcomeLine(line) && !a.includes(line)) added++;
    else if (line === SPEC_REVIEW_STE774_LINE && !a.includes(line)) ste774++;
    else kept.push(line);
  }
  const drift: string[] = [];
  if (kept.length !== a.length) drift.push(`line count ${a.length} → ${kept.length} (outcome lines excluded)`);
  const n = Math.min(kept.length, a.length);
  for (let i = 0; i < n; i++) if (kept[i] !== a[i]) drift.push(`line ${i + 1}`);
  return { drift, added, ste774 };
}

const rel = (skill: string): string => `${PLUGIN_REL}/skills/${skill}/SKILL.md`;
const now = (skill: string): string => readFileSync(join(PLUGIN_ROOT, "skills", skill, "SKILL.md"), "utf-8");

describe("AC-STE-715.18 line guards for tdd and spec-review", () => {
  for (const [skill, pin] of Object.entries(GUARDED)) {
    test(`CONTROL: the pinned digest is skills/${skill}/SKILL.md at the v3.0.0 merge commit`, () => {
      expect(sha(atV300(rel(skill)))).toBe(pin.v300Sha256);
    });
  }

  for (const skill of LINE_GUARDED) {
    const pin = GUARDED[skill];
    test(`skills/${skill}/SKILL.md differs from v3.0.0 only by ${pin.addedLines} added outcome line(s)`, () => {
      const r = driftBeyondOutcomeLines(atV300(rel(skill)), now(skill));
      // Amended by AC-STE-774.4 (M_4daa6e): plus exactly the admitted STE-774 line(s).
      expect({ skill, ...r }).toEqual({ skill, drift: [], added: pin.addedLines, ste774: STE774_LINES[skill] ?? 0 });
    });

    test(`NEIGHBOUR CONTROL: one other changed line in a temp copy of skills/${skill}/SKILL.md is reported`, () => {
      const lines = now(skill).split("\n");
      // Amended by AC-STE-774.4 (M_4daa6e): the neighbour is never the admitted STE-774 line itself.
      const target = lines.findIndex((l, i) => i > 20 && l.trim().length > 0 && !isOutcomeLine(l) && l !== SPEC_REVIEW_STE774_LINE);
      lines[target] = `${lines[target]} Then Read every file under specs/ first.`;
      const r = driftBeyondOutcomeLines(atV300(rel(skill)), lines.join("\n"));
      expect(r.drift.length).toBe(1);
      expect(r.drift[0]).toMatch(/^line \d+$/);
    });

    // Amended by AC-STE-774.4 (M_4daa6e). Kills: the STE-774 admission widened past its exact bytes.
    test(`CONTROL: the admitted STE-774 line of skills/${skill}/SKILL.md, edited by one clause, is reported`, () => {
      const lines = now(skill).split("\n");
      const at = lines.indexOf(SPEC_REVIEW_STE774_LINE);
      expect(at).toBeGreaterThan(0);
      lines[at] = `${lines[at]} Then Read every file under specs/ first.`;
      expect(driftBeyondOutcomeLines(atV300(rel(skill)), lines.join("\n")).drift).not.toEqual([]);
    });

    test(`CONTROL: an added non-outcome line in a temp copy of skills/${skill}/SKILL.md is reported`, () => {
      const lines = now(skill).split("\n");
      lines.splice(30, 0, "Before dispatching, Grep the repository for TODO markers.");
      expect(driftBeyondOutcomeLines(atV300(rel(skill)), lines.join("\n")).drift).not.toEqual([]);
    });
  }
});

describe("AC-STE-738.3 amends AC-STE-715.18 — skills/tdd/SKILL.md is re-based to its post-change digest", () => {
  test("the re-base names both AC ids and records its reason", () => {
    expect({ amends: TDD_REBASE.amends, by: TDD_REBASE.by }).toEqual({ amends: "AC-STE-715.18", by: "AC-STE-738.3" });
    expect(TDD_REBASE.reason).toMatch(/PR #121/);
    expect(TDD_REBASE.reason).toMatch(/operator ruled/);
    // spec-review keeps the v3.0.0 line guard; only tdd moved.
    expect([...LINE_GUARDED]).toEqual(["spec-review"]);
  });

  test("the pin is a sha256 digest (AC-STE-738.3 amends AC-STE-715.18)", () => {
    expect(TDD_REBASE.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  test("skills/tdd/SKILL.md matches its post-change digest (AC-STE-738.3 amends AC-STE-715.18)", () => {
    expect(driftFromRebase(now("tdd"))).toEqual([]);
  });

  // Kills: a re-base that stops reading the file (or pins whatever is there).
  // The unmodified file passes; any ONE other changed line, anywhere, fails.
  test("NEIGHBOUR CONTROL: one other changed line in a temp copy of skills/tdd/SKILL.md is rejected (AC-STE-738.3 amends AC-STE-715.18)", () => {
    const text = now("tdd");
    expect(driftFromRebase(text)).toEqual([]);
    const lines = text.split("\n");
    const targets = [lines.findIndex((l, i) => i > 20 && l.trim().length > 0 && !isOutcomeLine(l)), lines.length - 2, 1];
    for (const target of targets) {
      const copy = [...lines];
      copy[target] = `${copy[target]} Then Read every file under specs/ first.`;
      expect({ target, drift: driftFromRebase(copy.join("\n")).length }).toEqual({ target, drift: 1 });
    }
  });

  // Amended by AC-STE-774.4 (M_4daa6e). Kills: the STE-774 sentence admitted loosely, or more than once.
  test("CONTROL: the STE-774 sentence of skills/tdd/SKILL.md dropped, doubled or reworded is rejected", () => {
    const text = now("tdd");
    expect(driftFromRebase(text)).toEqual([]);
    const dropped = text.replace(TDD_STE774_SENTENCE, "");
    const doubled = text.replace(TDD_STE774_SENTENCE, TDD_STE774_SENTENCE + TDD_STE774_SENTENCE);
    const reworded = text.replace(TDD_STE774_SENTENCE, TDD_STE774_SENTENCE.replace("once per audit", "once per round"));
    for (const [name, copy] of [["dropped", dropped], ["doubled", doubled], ["reworded", reworded]] as const) {
      expect(copy).not.toBe(text);
      expect({ name, drift: driftFromRebase(copy).length }).toEqual({ name, drift: 1 });
    }
  });

  test("CONTROL: an added line in a temp copy of skills/tdd/SKILL.md is rejected (AC-STE-738.3 amends AC-STE-715.18)", () => {
    const lines = now("tdd").split("\n");
    expect(driftFromRebase(lines.join("\n"))).toEqual([]);
    lines.splice(30, 0, "Before dispatching, Grep the repository for TODO markers.");
    expect(driftFromRebase(lines.join("\n"))).not.toEqual([]);
  });
});
