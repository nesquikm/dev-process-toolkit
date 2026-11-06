// STE-715 (M_7bc805) AC.18 — line guards for skills/tdd/SKILL.md and
// skills/spec-review/SKILL.md against their v3.0.0 bytes.
//
// Neither file had a line freeze before this FR. This is a `driftBeyond`-style
// check in the AC-STE-618.8 shape: the v3.0.0 bytes are pinned by their sha256
// (a literal, verified against the v3.0.0 merge commit), and today's file must
// equal them once the outcome lines this FR adds are taken out. So any other
// new instruction — a Read, a Grep, a reworded line — is drift, which a model
// of `bun run` calls alone cannot see.

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

const OUTCOME_ORDER = 'bun run "${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/gate_receipt.ts" outcome';

/** A line this FR may add: it orders the outcome verb and names the `outcome: on` condition. */
function isOutcomeLine(line: string): boolean {
  return line.includes(OUTCOME_ORDER) && line.includes("`outcome: on`");
}

/**
 * The guard. Returns every drift beyond the permitted added outcome lines,
 * named by the v3.0.0 line it sits at, plus the count of added outcome lines.
 */
function driftBeyondOutcomeLines(before: string, after: string): { drift: string[]; added: number } {
  const a = before.split("\n");
  const kept: string[] = [];
  let added = 0;
  for (const line of after.split("\n")) {
    if (isOutcomeLine(line) && !a.includes(line)) added++;
    else kept.push(line);
  }
  const drift: string[] = [];
  if (kept.length !== a.length) drift.push(`line count ${a.length} → ${kept.length} (outcome lines excluded)`);
  const n = Math.min(kept.length, a.length);
  for (let i = 0; i < n; i++) if (kept[i] !== a[i]) drift.push(`line ${i + 1}`);
  return { drift, added };
}

const rel = (skill: string): string => `${PLUGIN_REL}/skills/${skill}/SKILL.md`;
const now = (skill: string): string => readFileSync(join(PLUGIN_ROOT, "skills", skill, "SKILL.md"), "utf-8");

describe("AC-STE-715.18 line guards for tdd and spec-review", () => {
  for (const [skill, pin] of Object.entries(GUARDED)) {
    test(`CONTROL: the pinned digest is skills/${skill}/SKILL.md at the v3.0.0 merge commit`, () => {
      expect(sha(atV300(rel(skill)))).toBe(pin.v300Sha256);
    });

    test(`skills/${skill}/SKILL.md differs from v3.0.0 only by ${pin.addedLines} added outcome line(s)`, () => {
      const r = driftBeyondOutcomeLines(atV300(rel(skill)), now(skill));
      expect({ skill, ...r }).toEqual({ skill, drift: [], added: pin.addedLines });
    });

    test(`NEIGHBOUR CONTROL: one other changed line in a temp copy of skills/${skill}/SKILL.md is reported`, () => {
      const lines = now(skill).split("\n");
      const target = lines.findIndex((l, i) => i > 20 && l.trim().length > 0 && !isOutcomeLine(l));
      lines[target] = `${lines[target]} Then Read every file under specs/ first.`;
      const r = driftBeyondOutcomeLines(atV300(rel(skill)), lines.join("\n"));
      expect(r.drift.length).toBe(1);
      expect(r.drift[0]).toMatch(/^line \d+$/);
    });

    test(`CONTROL: an added non-outcome line in a temp copy of skills/${skill}/SKILL.md is reported`, () => {
      const lines = now(skill).split("\n");
      lines.splice(30, 0, "Before dispatching, Grep the repository for TODO markers.");
      expect(driftBeyondOutcomeLines(atV300(rel(skill)), lines.join("\n")).drift).not.toEqual([]);
    });
  }
});
