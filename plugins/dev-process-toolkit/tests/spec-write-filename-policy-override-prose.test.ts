import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { specWriteStep7Map } from "./_skill-md";

// STE-182 AC-STE-182.5 — /spec-write Step 7 `filename_policy_override` row
// renders conditionally: "no user override" prose on the common path, an
// "overrode user-proposed" prose when the user proposed an alternative.
//
// Background: the 2026-05-01 Jira smoke (v2.3.0) F4 caught the unconditional
// "the user-proposed name was overridden" prose firing on runs where no user
// filename was proposed (the common pre-baked stub path). The wording read as
// if the user supplied a name and it was silently replaced; the fix is to
// surface a different variant when no override actually happened.
//
// The conditional is LLM-applied, not code-applied — the SKILL.md prose is
// the contract. These tests assert the SKILL.md carries both variants plus
// the annotation that distinguishes when each fires.

const pluginRoot = join(import.meta.dir, "..");
const specWriteSkill = join(pluginRoot, "skills", "spec-write", "SKILL.md");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("AC-STE-182.5(a) Linear new-FR no user-proposed filename → 'no user override' variant", () => {
  test("the static map row carries the 'no user override' literal", () => {
    const map = specWriteStep7Map(read(specWriteSkill));
    // The conditional row must surface the no-override variant prose so the
    // LLM picks it on the common path.
    expect(map).toMatch(/no user override/);
  });

  test("the static map row references Provider.filenameFor as the authoritative source", () => {
    const map = specWriteStep7Map(read(specWriteSkill));
    expect(map).toMatch(/Provider\.filenameFor/);
  });
});

describe("AC-STE-182.5(b) user explicitly proposed alternative → 'overrode user-proposed' variant", () => {
  test("the static map row carries the 'overrode user-proposed' literal", () => {
    const map = specWriteStep7Map(read(specWriteSkill));
    // The override variant must still exist for legitimate paths where the
    // user typed a filename in conversation.
    expect(map).toMatch(/overrode user-proposed/);
  });

  test("the override variant captures a user-supplied name placeholder", () => {
    const map = specWriteStep7Map(read(specWriteSkill));
    // Anchor the user-name slot — `<user-name>` is the prose contract for
    // substitution of the user-proposed filename.
    expect(map).toMatch(/<user-name>|<user-proposed>/);
  });
});

describe("AC-STE-182.5(c) Jira new-FR no user-proposed filename → 'no user override' variant", () => {
  test("Jira filename shape is mentioned in the override discussion", () => {
    const body = read(specWriteSkill);
    // Provider.filenameFor for Jira is `<KEY>-N.md`; for Linear it's
    // `<TKR>-N.md`. The unconditional-emit prose names both.
    expect(body).toMatch(/<TKR>-NN\.md.*<TKR>|DST-NN\.md|<KEY>-/);
  });
});

describe("AC-STE-182.5(d) mode: none → row absent (existing exemption preserved)", () => {
  test("SKILL.md preserves the mode: none exemption verbatim", () => {
    const body = read(specWriteSkill);
    // The exemption note must remain — local-mint short ULIDs never carry an
    // override.
    expect(body).toMatch(/mode:\s*none.*exempt|local-mint.*never/i);
    expect(body).toMatch(/short-ULID stem/i);
  });
});

describe("AC-STE-182.3 — annotation documents when each variant fires", () => {
  test("SKILL.md carries an explicit annotation below the row", () => {
    const body = read(specWriteSkill);
    // The annotation must explain that variant (a) fires when no user
    // proposed a name, variant (b) when the user proposed one. Pin the
    // resolver-entry-context anchor since that is where the LLM reads the
    // signal.
    expect(body).toMatch(/Annotation:|annotation/);
    expect(body).toMatch(/no user-proposed.*filename|user explicitly proposed/i);
  });

  test("annotation calls out that the row fires on both variants", () => {
    const body = read(specWriteSkill);
    expect(body).toMatch(/row fires on both variants|both variants — only the prose/i);
  });
});

describe("AC-STE-182.2 — unconditional-emit rule preserved verbatim", () => {
  test("the firing rule remains 'every tracker-mode FR write or import'", () => {
    const body = read(specWriteSkill);
    // The Filename-policy override row paragraph must keep the
    // unconditional-emit contract: row fires regardless of whether the user
    // proposed an alternative.
    expect(body).toMatch(/regardless of whether the user proposed an alternative/);
  });
});

describe("AC-STE-182.1 — old single-static-string prose has been removed", () => {
  test("regression guard: the misleading 'the user-proposed name was overridden' literal is gone", () => {
    const map = specWriteStep7Map(read(specWriteSkill));
    // The pre-fix prose is the regression shape. Absence asserts the row
    // collapsed back to a single static string.
    expect(map).not.toMatch(/the user-proposed name was overridden by the adapter convention/);
  });
});
