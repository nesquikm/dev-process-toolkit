// M131 STE-503 — the DOCUMENTED half of AC-STE-503.1.
//
// The config surface (adapters/_shared/src/verification_config.ts) already
// closes the `## Verification` key set at four and is GREEN under
// tests/m131-ste-503-verification-keys.test.ts. The prose that TEACHES that
// contract still says two. STE-503's own `## Notes` names the blast radius:
// "…the authoring guide, and every worked example." These are the pins for
// that half.
//
// WHAT IS BROKEN, measured on this tree at authoring time (2026-08-24):
//
//   * docs/verification-skills.md § "The `## Verification` config contract" —
//     the worked example block carries only `verify_skill` / `verify_mode`,
//     the sentence reads "The key set is **closed** — exactly these two
//     keys.", and the Key/Meaning table has exactly two rows. A reader who
//     follows this guide writes a two-key block and never learns `run_cmd`
//     exists.
//   * docs/layout-reference.md § Verification — "The section's top-level key
//     set is **closed** — exactly `{verify_skill, verify_mode}`". This is the
//     layout reference: it is the file another skill is pointed at to learn
//     the shape, and it enumerates the wrong set explicitly.
//   * templates/CLAUDE.md.template — the commented-out Verification guidance
//     says "The key set is closed — exactly the two keys shown", its example
//     shows two keys, and its `Keys:` list has two entries. This is the file
//     `/setup` copies into every consuming project, so the stale contract is
//     the one that physically lands on disk in user repos.
//
// WHY THE EXISTING SUITE DID NOT CATCH THIS.
//
//   tests/m93-ste-347-verification-convention.test.ts asserts
//   `expect(region).toMatch(/closed/i)` and `expect(region).toContain(
//   "verify_skill")`. Both are true of the STALE prose AND of the corrected
//   prose — they cannot distinguish them, which is exactly how a widened key
//   set shipped with a two-key guide still green. Nothing in that file is
//   weakened or removed here; these are additive, discriminating pins.
//
// TEST STRATEGY — every assertion below can fail on the CURRENT bytes.
//
//   * POSITIVE + NEGATIVE, ALWAYS PAIRED. A surface that merely gains a
//     mention of `run_cmd` while keeping "exactly these two keys" is still
//     wrong prose — worse than before, because it now self-contradicts. So
//     each surface is asserted to name all four keys AND to no longer carry
//     its own retired closed-set literal, verbatim.
//   * THE CLOSED-SET SENTENCE IS ASSERTED, NOT THE FILE. A bare /closed/i over
//     a whole file is satisfied by any leftover sentence anywhere in it. Here
//     the region is split into candidate STATEMENTS (table rows, list items,
//     sentences) and the statement that says "closed" must itself carry the
//     new width — either the word "four" or all four key names. A file that
//     gains a correct paragraph elsewhere but keeps the old sentence fails.
//   * AC.2's DISTINCTION IS ASSERTED AS ONE STATEMENT. `run_cmd: none` and
//     "absent" must co-occur in a single row / bullet / sentence. Requiring
//     only that both words appear SOMEWHERE in the section is satisfied
//     today-ish by the unrelated "Absent key ⇒ default `advisory`" row, which
//     is the vacuity this pass exists to avoid.
//
// House constraints honoured: no assertion demands an `STE-`/`M<N>` token in
// templates/** (tests/templates-no-internal-namespace.test.ts hard-blocks
// those), and nothing here reaches into skills/**.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pluginRoot = join(import.meta.dir, "..");

const read = (...parts: string[]) =>
  readFileSync(join(pluginRoot, ...parts), "utf8");

const verificationGuide = read("docs", "verification-skills.md");
const layoutReference = read("docs", "layout-reference.md");
const claudeTemplate = read("templates", "CLAUDE.md.template");

const FOUR_KEYS = ["verify_skill", "verify_mode", "run_cmd", "e2e_cmd"] as const;

/**
 * Slice a markdown `##` section by a predicate on its heading line, tracking
 * fenced code blocks so an example that itself contains a `## ` line (the
 * authoring guide has one) does not truncate the region.
 */
function markdownSection(body: string, headingMatch: RegExp): string {
  const lines = body.split("\n");
  let start = -1;
  let fenced = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    if (!/^##\s/.test(line)) continue;
    if (start === -1) {
      if (headingMatch.test(line)) start = i;
      continue;
    }
    return lines.slice(start, i).join("\n");
  }
  return start === -1 ? "" : lines.slice(start).join("\n");
}

/** The commented-out Verification guidance block inside the CLAUDE.md template. */
function templateVerificationComment(body: string): string {
  const start = body.indexOf("Optional: Verification section");
  if (start === -1) return "";
  const end = body.indexOf("-->", start);
  return end === -1 ? body.slice(start) : body.slice(start, end);
}

/**
 * Split a region into the smallest units a claim can honestly live in:
 * table rows, list items (bullet + its continuation lines), and prose
 * sentences. Deliberately NOT the whole region — a claim assembled from two
 * unrelated statements is not a claim.
 */
function statements(region: string): string[] {
  const out: string[] = [];
  let prose: string[] = [];
  let bullet: string[] | null = null;

  const flushBullet = () => {
    if (!bullet) return;
    const text = bullet.join(" ").replace(/\s+/g, " ").trim();
    if (text) out.push(text);
    bullet = null;
  };
  const flushProse = () => {
    const text = prose.join(" ").replace(/\s+/g, " ").trim();
    prose = [];
    if (!text) return;
    for (const sentence of text.split(/(?<=[.!?])\s+/)) {
      const trimmed = sentence.trim();
      if (trimmed) out.push(trimmed);
    }
  };

  for (const raw of region.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("|")) {
      flushBullet();
      flushProse();
      out.push(line);
      continue;
    }
    if (/^([-*]|\d+\.)\s/.test(line)) {
      flushProse();
      flushBullet();
      bullet = [line];
      continue;
    }
    if (bullet) {
      if (line === "") flushBullet();
      else bullet.push(line);
      continue;
    }
    if (line === "") flushProse();
    else prose.push(line);
  }
  flushBullet();
  flushProse();
  return out;
}

const NONE_LITERAL = /`?\brun_cmd:\s*none\b`?/;
const ABSENCE_WORD = /\babsent\b|\babsence\b|\bomitted\b|\bunanswered\b/i;

/**
 * Collapse newlines before matching a multi-word literal.
 *
 * NOT cosmetic: the template's shipped sentence hard-wraps as "exactly the
 * two\nkeys shown", so `toContain("exactly the two keys shown")` against the
 * raw region PASSED on the stale bytes — a pin that could not fail. Every
 * phrase-level assertion below runs against the flattened form.
 */
const flatten = (region: string) => region.replace(/\s+/g, " ");

const SURFACES = [
  {
    label: "docs/verification-skills.md (the authoring guide)",
    region: markdownSection(
      verificationGuide,
      /^##\s+The\s+`## Verification`\s+config contract\s*$/,
    ),
    // The exact sentence that must be retired, byte-for-byte as it ships today.
    retired: "exactly these two keys",
  },
  {
    label: "docs/layout-reference.md § Verification",
    region: markdownSection(layoutReference, /^##\s+Verification\s*$/),
    retired: "exactly `{verify_skill, verify_mode}`",
  },
  {
    label: "templates/CLAUDE.md.template (the file /setup copies out)",
    region: templateVerificationComment(claudeTemplate),
    retired: "exactly the two keys shown",
  },
] as const;

describe("AC-STE-503.1 — the documented key set is four, on every surface", () => {
  for (const surface of SURFACES) {
    describe(surface.label, () => {
      test("the region is non-empty (guards a silently-renamed heading)", () => {
        expect(surface.region.length).toBeGreaterThan(0);
      });

      for (const key of FOUR_KEYS) {
        test(`names \`${key}\``, () => {
          expect(surface.region).toContain(key);
        });
      }

      test("its closed-set statement declares the new width, not just the word 'closed'", () => {
        const closedStatements = statements(surface.region).filter((s) =>
          /closed/i.test(s),
        );
        // There must still BE a closed-set claim — silently dropping the
        // closed-set discipline is not a fix for the width being wrong.
        expect(closedStatements.length).toBeGreaterThan(0);

        const widened = closedStatements.filter(
          (s) =>
            /\bfour\b/i.test(s) || FOUR_KEYS.every((key) => s.includes(key)),
        );
        expect(widened).not.toEqual([]);
      });

      test("the retired two-key literal is gone", () => {
        const flat = flatten(surface.region);
        // Sanity: the literal is written to match the SHIPPED bytes, so this
        // assertion is known-failing today rather than trivially satisfied.
        expect(flatten(surface.retired)).toBe(surface.retired);
        expect(flat).not.toContain(surface.retired);
        expect(flat).not.toMatch(/\btwo keys\b/i);
      });

      test("`run_cmd: none` is documented as a declared answer, distinct from an absent key", () => {
        expect(flatten(surface.region)).toMatch(NONE_LITERAL);

        // The distinction has to live in ONE statement. "run_cmd exists" in one
        // row plus "Absent key ⇒ default advisory" in another (the pre-existing
        // verify_mode row) is not a statement about run_cmd at all.
        const distinguishing = statements(surface.region).filter(
          (s) =>
            s.includes("run_cmd") && /\bnone\b/i.test(s) && ABSENCE_WORD.test(s),
        );
        expect(distinguishing).not.toEqual([]);
      });
    });
  }
});
