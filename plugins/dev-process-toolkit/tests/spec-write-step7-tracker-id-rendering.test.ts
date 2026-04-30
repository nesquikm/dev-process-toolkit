import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { specWriteStep7Map } from "./_skill-md";

// STE-158 AC-STE-158.4 — /spec-write must surface a filename-policy-override
// row in tracker mode whenever `Provider.filenameFor(spec)` overrides the
// user-proposed filename, regardless of whether the user proposed an
// alternative.
//
// Smoke #6 finding F5 (Jira): the user prompt requested
// `<ulid>-greet-helper.md`; spec-write correctly applied the jira-mode
// filename policy (`DST-2.md`) but only mentioned the override when the
// user's prompt happened to carry an escape hatch. The fix surfaces the
// override unconditionally via a new capability key in Step 7's
// plain-language map.

const pluginRoot = join(import.meta.dir, "..");
const specWriteSkill = join(pluginRoot, "skills", "spec-write", "SKILL.md");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("AC-STE-158.4 — Step 7 plain-language map carries filename_policy_override", () => {
  test("the canonical key is present in the static map", () => {
    const map = specWriteStep7Map(read(specWriteSkill));
    expect(map).toMatch(/\| `filename_policy_override` \|/);
  });

  test("the rendered prose names tracker policy + filename derivation", () => {
    const map = specWriteStep7Map(read(specWriteSkill));
    // The row body must carry the operator-actionable signal: filename is
    // derived from the tracker policy (Provider.filenameFor), not from the
    // user's proposed name.
    const rowMatch = map.match(/\| `filename_policy_override` \| ([^|]+) \|/);
    expect(rowMatch).not.toBeNull();
    const rowBody = rowMatch![1];
    expect(rowBody).toMatch(/tracker policy|filenameFor|Provider/i);
    expect(rowBody).toMatch(/filename|file name/i);
  });
});

describe("AC-STE-158.4 — Step 7 prose mandates the override row in tracker mode", () => {
  test("spec-write prose explicitly fires the row in tracker mode regardless of user-proposed filename", () => {
    const body = read(specWriteSkill);
    // The fix surfaces the override unconditionally — even when the user
    // didn't propose an alternative filename. Prose must call this out so
    // the LLM doesn't fall back to the conditional smoke-#6 behaviour.
    expect(body).toMatch(/filename_policy_override/);
    // Anchor the unconditional firing rule. Pin "regardless" or
    // "every tracker-mode" or "even when the user did not propose"
    // shape.
    expect(body).toMatch(/regardless of (?:the user|whether)|every tracker-mode|even when (?:the user did not|no alternative)|tracker mode (?:always|unconditionally)/i);
  });

  test("mode: none does not fire the row (filename is local-mint)", () => {
    const body = read(specWriteSkill);
    // mode: none uses the short-ULID stem minted locally — there is no
    // policy override to surface. Prose must call out the mode-none
    // exclusion so the row doesn't fire on local-mint runs.
    expect(body).toMatch(/mode: none.*(?:never|local-mint|exempt|skip|absent)/i);
  });
});
