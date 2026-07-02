import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// STE-351 AC-STE-351.1 + AC-STE-351.3 + AC-STE-351.4 — prose contracts
// for the strengthened /conformance-loop Phase 0 pre-flight (and the
// /smoke-test mirror).
//
// AC-STE-351.1: pre-flight (f) asserts `permissions.allow` CONTAINS the
//   child-spawn pattern `Bash(claude:*)` (not merely `length > 0`);
//   a missing pattern refuses with the NFR-10 canonical shape naming
//   the remedy (add the spawn pattern to the allow-list). Mirror
//   assertion in /smoke-test's pre-flight section.
//
// AC-STE-351.3: a new Phase 0 refusal fires when `ANTHROPIC_API_KEY`
//   or `ANTHROPIC_AUTH_TOKEN` is set (subscription-billing guard);
//   NFR-10 shape; interactive-override path documented.
//
// AC-STE-351.4: the allow-list pre-flight emits the byte-checkable
//   capability token `spawn_pattern_allow_present` on the hit path,
//   consistent with the existing `permissions_allow_present` convention
//   (logged to /tmp/dpt-conformance-loop-<date>-approval.txt).
//
// Sibling to tests/conformance-loop-permissions-pre-flight.test.ts
// (STE-252) — regex/contains assertions over the SKILL.md bodies.

const repoRoot = join(import.meta.dir, "..", "..", "..");
const conformanceLoopPath = join(
  repoRoot,
  ".claude",
  "skills",
  "conformance-loop",
  "SKILL.md",
);
const smokeTestPath = join(repoRoot, ".claude", "skills", "smoke-test", "SKILL.md");

function readIfPresent(p: string): string | null {
  if (!existsSync(p)) return null;
  return readFileSync(p, "utf8");
}

/**
 * Slice a level-2 `## <heading>` section out of a markdown body.
 * Returns the text from the heading line up to (exclusive) the next
 * `## ` heading, or "" when the heading is absent.
 */
function sliceSection(body: string, heading: string): string {
  const idx = body.indexOf(`## ${heading}`);
  if (idx === -1) return "";
  const tail = body.slice(idx);
  const next = tail.search(/\n## \S/);
  return next === -1 ? tail : tail.slice(0, next);
}

const SPAWN_PATTERN = "Bash(claude:*)";

const cl = readIfPresent(conformanceLoopPath);
const st = readIfPresent(smokeTestPath);

const describeConformance = cl === null ? describe.skip : describe;
const describeSmoke = st === null ? describe.skip : describe;

describeConformance(
  "AC-STE-351.1 — /conformance-loop pre-flight (f) contains-check for the child-spawn pattern",
  () => {
    test("pre-flight names the literal spawn pattern near `permissions.allow` (contains-check, not merely length > 0)", () => {
      const body = cl!;
      // The strengthened (f) must name the canonical spawn-pattern
      // literal in the same pre-flight prose that reads
      // `.permissions.allow` — a `length > 0` assertion alone shipped
      // the M94 false-green undetected.
      expect(body).toContain(SPAWN_PATTERN);
      expect(body).toMatch(
        /permissions\.allow[\s\S]{0,700}Bash\(claude:\*\)|Bash\(claude:\*\)[\s\S]{0,700}permissions\.allow/,
      );
    });

    test("pre-flight probe shape is a contains/index check on the spawn pattern", () => {
      const body = cl!;
      // The FR's technical design gives the jq shape
      // `jq -e '.permissions.allow | index("Bash(claude:*)")'` as the
      // example. We accept any contains/index phrasing, but it must sit
      // next to the pattern literal — not merely a non-empty check.
      expect(body).toMatch(
        /(index\(|contains?)[\s\S]{0,300}Bash\(claude:\*\)|Bash\(claude:\*\)[\s\S]{0,300}(index\(|contains?)/i,
      );
    });

    test("missing-pattern refusal carries NFR-10 canonical shape naming the remedy (add the spawn pattern)", () => {
      const body = cl!;
      // Miss-path: refusal must (a) name the pattern, (b) carry a
      // Remedy: pointing at the allow-list, (c) carry a Context: line
      // for skill=conformance-loop — the (a)-(f) refusal convention.
      expect(body).toMatch(
        /Bash\(claude:\*\)[\s\S]{0,900}Remedy:[\s\S]{0,400}(allow-list|allowlist|permissions\.allow)/,
      );
      expect(body).toMatch(
        /Bash\(claude:\*\)[\s\S]{0,1400}Context:[^\n]*skill=conformance-loop/,
      );
    });
  },
);

describeSmoke(
  "AC-STE-351.1 — /smoke-test pre-flight mirrors the spawn-pattern contains-check",
  () => {
    test("`## Pre-flight refusals` section itself carries the spawn-pattern contains assertion", () => {
      const body = st!;
      // The pattern literal already appears in the Phase 1 step 6
      // scaffold heredoc and in later prose — those do NOT satisfy the
      // AC. The mirror assertion must live inside the pre-flight
      // section so it fires before any side effects.
      const section = sliceSection(body, "Pre-flight refusals");
      expect(section.length).toBeGreaterThan(0);
      expect(section).toContain(SPAWN_PATTERN);
      expect(section).toMatch(/permissions\.allow/);
    });
  },
);

describeConformance(
  "AC-STE-351.3 — ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN subscription-billing guard",
  () => {
    test("Phase 0 pre-flight names BOTH env vars in one guard", () => {
      const body = cl!;
      expect(body).toContain("ANTHROPIC_API_KEY");
      expect(body).toContain("ANTHROPIC_AUTH_TOKEN");
      // Both vars are covered by the SAME refusal (g), so they must
      // co-occur within one guard's prose window.
      expect(body).toMatch(
        /ANTHROPIC_API_KEY[\s\S]{0,400}ANTHROPIC_AUTH_TOKEN|ANTHROPIC_AUTH_TOKEN[\s\S]{0,400}ANTHROPIC_API_KEY/,
      );
    });

    test("guard names the billing rationale (API account / per-token vs subscription)", () => {
      const body = cl!;
      expect(body).toMatch(
        /ANTHROPIC_(API_KEY|AUTH_TOKEN)[\s\S]{0,700}(bill\w*|per-token|subscription)/i,
      );
    });

    test("guard refusal carries NFR-10 canonical shape (Remedy: unset ... + Context: skill=conformance-loop)", () => {
      const body = cl!;
      expect(body).toMatch(
        /ANTHROPIC_(API_KEY|AUTH_TOKEN)[\s\S]{0,1200}Remedy:[\s\S]{0,400}unset/i,
      );
      expect(body).toMatch(
        /ANTHROPIC_(API_KEY|AUTH_TOKEN)[\s\S]{0,1600}Context:[^\n]*skill=conformance-loop/,
      );
    });

    test("interactive-override path is documented next to the guard", () => {
      const body = cl!;
      // An operator who WANTS API billing unsets the guard or re-runs
      // interactively acknowledging the cost — the override must be
      // documented, not implicit.
      expect(body).toMatch(
        /ANTHROPIC_(API_KEY|AUTH_TOKEN)[\s\S]{0,1600}(interactiv\w*|override)/i,
      );
    });
  },
);

describeConformance(
  "AC-STE-351.4 — spawn_pattern_allow_present capability token on the hit path",
  () => {
    test("hit-path emits the literal byte-checkable token", () => {
      const body = cl!;
      expect(body).toContain("spawn_pattern_allow_present");
    });

    test("token follows the approval-file capability-row convention alongside permissions_allow_present", () => {
      const body = cl!;
      // Same convention as the existing STE-252 token: one literal
      // line logged to /tmp/dpt-conformance-loop-<date>-approval.txt,
      // byte-grep-checkable downstream.
      expect(body).toContain("permissions_allow_present");
      expect(body).toMatch(
        /spawn_pattern_allow_present[\s\S]{0,900}approval\.txt|approval\.txt[\s\S]{0,900}spawn_pattern_allow_present/,
      );
    });
  },
);
