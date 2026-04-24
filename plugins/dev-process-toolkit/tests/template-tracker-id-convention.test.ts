import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// STE-80 — prose-assertion test guarding AC-STE-80.1..4: the two spec
// templates that a user copying from `templates/spec-templates/` by hand
// would start from must carry the `<tracker-id>` placeholder convention
// guidance (STE-66) and at least one seeded example using the literal
// placeholder. This is the reach-extension for users who bypass
// `/spec-write` — same invariant the SKILL.md-level test
// (`spec-write-placeholder-convention.test.ts`) enforces for the skill.

const pluginRoot = join(import.meta.dir, "..");
const requirementsTemplate = join(
  pluginRoot,
  "templates",
  "spec-templates",
  "requirements.md.template",
);
const planTemplate = join(
  pluginRoot,
  "templates",
  "spec-templates",
  "plan.md.template",
);

function readTemplate(path: string): string {
  return readFileSync(path, "utf8");
}

describe("STE-80 — requirements.md.template carries the <tracker-id> convention", () => {
  test("AC-STE-80.1: top-of-file HTML comment references STE-66 / <tracker-id>", () => {
    const body = readTemplate(requirementsTemplate);
    const firstBlock = body.split("\n").slice(0, 20).join("\n");
    expect(firstBlock).toMatch(/<!--/);
    expect(firstBlock).toContain("<tracker-id>");
    expect(firstBlock).toMatch(/STE-66|STE-80/);
  });

  test("AC-STE-80.1: comment links to docs/spec-write-tracker-mode.md", () => {
    const body = readTemplate(requirementsTemplate);
    expect(body).toContain("spec-write-tracker-mode.md");
  });

  test("AC-STE-80.3: guidance is in a proper HTML comment block (not rendered)", () => {
    const body = readTemplate(requirementsTemplate);
    // The opening comment must be `<!--` at the very top so downstream
    // markdown renderers (GitHub, VS Code preview) skip it entirely.
    expect(body.startsWith("<!--")).toBe(true);
    expect(body).toMatch(/<!--[\s\S]*?-->/);
  });

  test("AC-STE-80.4: at least one seeded example uses the literal <tracker-id> placeholder", () => {
    const body = readTemplate(requirementsTemplate);
    expect(body).toContain("<tracker-id>");
  });
});

describe("STE-80 — plan.md.template carries the <tracker-id> convention", () => {
  test("AC-STE-80.2: top-of-file HTML comment references STE-66 / <tracker-id>", () => {
    const body = readTemplate(planTemplate);
    const firstBlock = body.split("\n").slice(0, 20).join("\n");
    expect(firstBlock).toMatch(/<!--/);
    expect(firstBlock).toContain("<tracker-id>");
    expect(firstBlock).toMatch(/STE-66|STE-80/);
  });

  test("AC-STE-80.2: comment links to docs/spec-write-tracker-mode.md", () => {
    const body = readTemplate(planTemplate);
    expect(body).toContain("spec-write-tracker-mode.md");
  });

  test("AC-STE-80.3: guidance is in a proper HTML comment block (not rendered)", () => {
    const body = readTemplate(planTemplate);
    expect(body.startsWith("<!--")).toBe(true);
    expect(body).toMatch(/<!--[\s\S]*?-->/);
  });

  test("AC-STE-80.4: at least one seeded example uses the literal <tracker-id> placeholder", () => {
    const body = readTemplate(planTemplate);
    expect(body).toContain("<tracker-id>");
  });
});
