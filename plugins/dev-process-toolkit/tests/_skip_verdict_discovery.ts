// _skip_verdict_discovery — how a test finds `SkipVerdict`'s cause discriminator
// and the cause vocabulary WITHOUT hard-coding either name.
//
// WHY THIS IS SHARED. Two test files needed this pair, so it was written twice.
// When M136 / STE-529 added non-vocabulary fields to `SkipVerdict`, one copy was
// corrected and the other was not — and the stale one then blocked a legitimate
// implementation while claiming to protect a rule it no longer stated. That is
// the sibling-surface shape this repository has now hit four times, and a third
// copy would hit it again. One home, one spelling.

import { expect } from "bun:test";
import { readFileSync } from "node:fs";

/** The four fields every verdict carries; anything else is a candidate. */
const KNOWN_VERDICT_FIELDS = ["outcome", "baseline", "current", "delta"];

/** Minimal shape this module needs of the module under discovery. */
export interface VocabularyBearingModule {
  readonly SKIP_OUTCOMES: readonly string[];
}

/**
 * The incomparable cause discriminator, READ OUT of the `SkipVerdict`
 * interface rather than assumed.
 *
 * It is identified by the property that actually defines it: its VALUES ARE
 * DRAWN FROM AN EXPORTED VOCABULARY. The module spells a vocabulary-typed field
 * one way and one way only — `export const X = [...] as const` paired with
 * `export type T = (typeof X)[number]` — so the discriminator is the extra
 * field whose declared type resolves through that pairing. Nothing here is
 * spelled `cause`, and nothing here counts fields.
 *
 * WHY IT NO LONGER COUNTS. M136 / STE-529 gives `SkipVerdict` fields that are
 * not vocabularies — which comparison was made, and the identities it found —
 * and an "exactly one extra field" rule would have refused them while claiming
 * to be about the cause. Exactly-one is still asserted, but over the fields
 * this helper's own criterion selects: a SECOND vocabulary-typed field would
 * leave the discriminator undetermined, and that is the state worth refusing.
 * `outcome` is excluded before the criterion runs (it is one of the four known
 * fields), so `SKIP_OUTCOMES` is never a candidate and is never named here.
 */
export function discoverCauseField(skipBaselineFile: string): string {
  const source = readFileSync(skipBaselineFile, "utf-8");
  const at = source.indexOf("export interface SkipVerdict {");
  expect(at).toBeGreaterThan(-1);

  const rest = source.slice(at);
  const close = rest.indexOf("\n}");
  expect(close).toBeGreaterThan(-1);
  const body = rest.slice(0, close);

  // Every exported type that is a member-of-an-exported-string-array — the
  // module's one spelling for a vocabulary.
  const vocabularyTypes = new Set(
    [...source.matchAll(/export type (\w+) = \(typeof (\w+)\)\[number\];/g)].map(
      (hit) => hit[1] as string,
    ),
  );
  expect(
    vocabularyTypes.size,
    "skip_baseline.ts declares no vocabulary-backed type, so no field can be discovered",
  ).toBeGreaterThan(0);

  const fields = [...body.matchAll(/^\s*readonly\s+([A-Za-z_$][\w$]*)\??\s*:\s*([^;\n]+);/gm)].map(
    (hit) => ({ name: hit[1] as string, type: (hit[2] as string).trim() }),
  );
  const extra = fields.filter(
    (field) => !KNOWN_VERDICT_FIELDS.includes(field.name) && vocabularyTypes.has(field.type),
  );

  expect(
    extra.map((field) => field.name),
    "SkipVerdict must carry exactly ONE field beyond outcome/baseline/current/delta whose " +
      "values are drawn from an exported vocabulary: the incomparable cause discriminator " +
      "AC-STE-530.8 needs to tell the conditions apart",
  ).toHaveLength(1);

  return (extra[0] as { name: string }).name;
}

/**
 * The cause vocabulary, discovered as the module's one exported string array
 * besides `SKIP_OUTCOMES` — the same house shape, so the same discovery.
 */
export function discoverCauses(mod: VocabularyBearingModule): readonly string[] {
  const arrays = Object.entries(mod as unknown as Record<string, unknown>).filter(
    ([name, value]) =>
      name !== "SKIP_OUTCOMES" &&
      Array.isArray(value) &&
      value.length > 0 &&
      value.every((member) => typeof member === "string"),
  );

  expect(
    arrays.map(([name]) => name),
    "skip_baseline must export exactly ONE cause vocabulary besides SKIP_OUTCOMES",
  ).toHaveLength(1);

  const causes = arrays[0]?.[1] as readonly string[];
  expect(
    new Set(causes).size,
    "the incomparable causes are at least two: a foreign checkout, and a named " +
      "baseline meeting an unnamed run (AC-STE-530.8)",
  ).toBeGreaterThanOrEqual(2);

  return causes;
}
