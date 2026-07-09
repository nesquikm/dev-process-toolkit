// Tests for /gate-check probe `deps_research_disposition_contract`
// (STE-373 AC-STE-373.7). Severity: error. Probe #65 (colocated sibling
// of the #51 deps_researcher_subagent_invariants probe).
//
// The probe byte-checks the DEFINITION-LEVEL disposition contract:
//   (a) both skip tokens `deps_research_skipped_no_manifest` /
//       `deps_research_skipped_no_tech` are registered in
//       CANONICAL_CAPABILITY_KEYS;
//   (b) the MUST-emit disposition directive (AC.5) AND the anti-cascade
//       rule (AC.6) are present in BOTH skills/brainstorm/SKILL.md and
//       skills/spec-write/SKILL.md;
//   (c) no `deps_research_skipped_*` token name introduced in the parent
//       skills contains `compromised` / `injected` / `disabled`.
//
// Vacuous when the plugin skills tree is absent. Mirrors the
// deps_researcher_invariants (#51) fixture pattern: fabricate a temp
// plugins/dev-process-toolkit/skills/{brainstorm,spec-write}/SKILL.md
// tree and drive the probe over it.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDepsResearchDispositionContractProbe } from "../adapters/_shared/src/deps_research_disposition_contract";

// A conforming parent-skill body: carries the complete MUST-emit
// disposition set (both new skip tokens included) AND explicit
// anti-cascade prose. Any reasonable directive/anti-cascade detector
// should pass on this body.
const VALID_SKILL = [
  "---",
  "name: parent",
  "description: parent skill fixture",
  "---",
  "",
  "# Parent skill",
  "",
  "Deps-research disposition — the step resolves to exactly one literal",
  "backticked token from the set below:",
  "",
  "- MUST emit `deps_research_invoked`",
  "- MUST emit `deps_research_no_matches`",
  "- MUST emit `deps_research_shape_violation`",
  "- MUST emit `deps_research_skipped_no_manifest`",
  "- MUST emit `deps_research_skipped_no_tech`",
  "",
  "Anti-cascade rule: a deps-research shape violation drops THIS seed and",
  "continues; it never disables the fork for future invocations. The skill",
  "holds no fork-compromised state and carries no cross-invocation belief",
  "about fork health.",
  "",
].join("\n");

interface FixtureSpec {
  brainstorm?: string | null;
  specWrite?: string | null;
}

function makeFixture(spec: FixtureSpec): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "deps-disposition-contract-"));
  const skillsBase = join(root, "plugins", "dev-process-toolkit", "skills");
  mkdirSync(skillsBase, { recursive: true });
  if (spec.brainstorm !== null) {
    const dir = join(skillsBase, "brainstorm");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), spec.brainstorm ?? VALID_SKILL);
  }
  if (spec.specWrite !== null) {
    const dir = join(skillsBase, "spec-write");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), spec.specWrite ?? VALID_SKILL);
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("AC-STE-373.7 — deps_research_disposition_contract probe", () => {
  test("fully conforming fixture ⇒ zero violations", async () => {
    const fx = makeFixture({});
    try {
      const r = await runDepsResearchDispositionContractProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("spec-write missing a skip-token MUST-emit directive ⇒ violation", async () => {
    const badSpecWrite = VALID_SKILL.replace(
      "- MUST emit `deps_research_skipped_no_manifest`\n",
      "",
    );
    const fx = makeFixture({ specWrite: badSpecWrite });
    try {
      const r = await runDepsResearchDispositionContractProbe(fx.root);
      expect(r.violations.length).toBeGreaterThan(0);
      expect(
        r.violations.some(
          (v) =>
            /deps_research_skipped_no_manifest/.test(v.message) ||
            /spec-write/.test(v.note),
        ),
      ).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("brainstorm missing the anti-cascade rule ⇒ violation", async () => {
    const badBrainstorm = VALID_SKILL.replace(
      /Anti-cascade rule:[\s\S]*fork health\./,
      "No anti-cascade prose here.",
    );
    const fx = makeFixture({ brainstorm: badBrainstorm });
    try {
      const r = await runDepsResearchDispositionContractProbe(fx.root);
      expect(r.violations.length).toBeGreaterThan(0);
      expect(
        r.violations.some(
          (v) =>
            /anti-cascade|cross-invocation|never disables/i.test(v.message) ||
            /brainstorm/.test(v.note),
        ),
      ).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("a forbidden `deps_research_skipped_*` token in a parent skill ⇒ violation", async () => {
    const badBrainstorm = `${VALID_SKILL}\n- MUST emit \`deps_research_skipped_injected\`\n`;
    const fx = makeFixture({ brainstorm: badBrainstorm });
    try {
      const r = await runDepsResearchDispositionContractProbe(fx.root);
      expect(r.violations.length).toBeGreaterThan(0);
      expect(
        r.violations.some((v) =>
          /injected|compromised|disabled|forbidden/i.test(
            `${v.reason} ${v.message}`,
          ),
        ),
      ).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  test("vacuous on a fresh repo with no plugin skills tree", async () => {
    const root = mkdtempSync(join(tmpdir(), "deps-disposition-empty-"));
    try {
      const r = await runDepsResearchDispositionContractProbe(root);
      expect(r.violations).toEqual([]);
      expect(r.vacuous).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("violation follows NFR-10 note + message shape (Remedy + Context, severity error)", async () => {
    const badSpecWrite = VALID_SKILL.replace(
      "- MUST emit `deps_research_skipped_no_tech`\n",
      "",
    );
    const fx = makeFixture({ specWrite: badSpecWrite });
    try {
      const r = await runDepsResearchDispositionContractProbe(fx.root);
      expect(r.violations.length).toBeGreaterThan(0);
      const v = r.violations[0]!;
      expect(v.severity).toBe("error");
      expect(v.note).toMatch(/ — /);
      expect(v.message).toMatch(/Remedy:/);
      expect(v.message).toMatch(/Context:/);
    } finally {
      fx.cleanup();
    }
  });
});
