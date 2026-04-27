import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// STE-129 AC-STE-129.1 / .2 — `templates/spec-templates/requirements.md.template`
// must declare its scope as "cross-cutting only" and drop the legacy
// `### FR-1: [Feature Name]` placeholder block.

const pluginRoot = join(import.meta.dir, "..");
const templatePath = join(pluginRoot, "templates", "spec-templates", "requirements.md.template");

function read(): string {
  return readFileSync(templatePath, "utf-8");
}

function stripFencedBlocks(src: string): string {
  const lines = src.split("\n");
  const out: string[] = [];
  let inFence = false;
  for (const line of lines) {
    if (/^```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    out.push(line);
  }
  return out.join("\n");
}

describe("AC-STE-129.1 — template declares scope = cross-cutting only", () => {
  test("template carries an explicit scope marker comment", () => {
    const tmpl = read();
    expect(tmpl).toMatch(/scope:\s*cross-cutting only|cross-cutting only/i);
  });
});

describe("AC-STE-129.2 — FR-1 placeholder block dropped from §2", () => {
  test("template no longer contains the legacy `### FR-1: [Feature Name]` heading", () => {
    const tmpl = read();
    const stripped = stripFencedBlocks(tmpl);
    // The placeholder heading is gone from active body content.
    expect(stripped).not.toMatch(/^###\s+FR-1:\s*\[Feature Name\]/m);
    expect(stripped).not.toMatch(/^###\s+FR-2:\s*\[Feature Name\]/m);
  });

  test("template instead lists cross-cutting examples (auth / observability / accessibility)", () => {
    const tmpl = read();
    // Body must reference at least two of the canonical cross-cutting topics
    // so authors recognize what belongs here vs. in `specs/frs/`.
    const topicHits = [/auth/i, /observability/i, /accessibility/i, /security/i, /performance/i].filter((re) =>
      re.test(tmpl),
    ).length;
    expect(topicHits).toBeGreaterThanOrEqual(2);
  });
});

describe("AC-STE-129.3 — /spec-write Step 3 prose matches the chosen scope", () => {
  test("Step 3 prose names cross-cutting scope and routes per-FR work to specs/frs/", () => {
    const skill = readFileSync(
      join(pluginRoot, "skills", "spec-write", "SKILL.md"),
      "utf-8",
    );
    // The per-section heading is `#### requirements.md (WHAT to build)`.
    const idx = skill.indexOf("#### requirements.md");
    expect(idx).toBeGreaterThan(-1);
    const tail = skill.slice(idx);
    const next = tail.slice(2).search(/\n####\s/);
    const section = next === -1 ? tail : tail.slice(0, next + 2);
    // Must explicitly note the cross-cutting scope and forbid per-FR writes.
    expect(section).toMatch(/cross-cutting/i);
    expect(section).toMatch(/specs\/frs/);
  });
});
