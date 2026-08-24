// STE-506 (M131) — the toolkit declares its own verification.
//
// Two halves, both asserted against THIS repository rather than a fixture:
//
//   AC-STE-506.2 — the slug heuristic stays narrow. Conformance- and
//     smoke-shaped slugs are not matched, this repo's OWN two driver slugs are
//     not matched either, the module's `SLUG_PATTERNS` constant is pinned to
//     exactly {drive, check, verify}, and the FR records WHY widening it was
//     rejected. The repo-real leg is the one that matters: it is precisely
//     because discovery cannot see `conformance-loop` or `smoke-test` that
//     AC.3's explicit declaration is needed.
//
//   AC-STE-506.3 — the dogfooding clause. The repo-root CLAUDE.md declares a
//     `## Verification` block, the block parses, the named skill RESOLVES on
//     disk, the mode is `manual` (with the shipped no-auto-run consequence
//     pinned alongside it), and `run_cmd: none` is MEASURED by running
//     `detectRunnability` against this tree rather than asserted from prose.
//     If detection ever starts firing here, the declared `none` becomes a lie
//     and that test must go red — that is the point.
//
// AC-STE-506.1 (frontmatter arm, end-to-end) and AC-STE-506.4 (multi-candidate
// list-and-ask) live with the scanner they exercise, in
// `adapters/_shared/src/scan_candidate_check_skills.test.ts`.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { detectRunnability } from "../adapters/_shared/src/detect_runnability";
import {
  SLUG_PATTERNS,
  scanCandidateCheckSkills,
} from "../adapters/_shared/src/scan_candidate_check_skills";
import {
  readVerificationConfig,
  resolveVerifyMode,
  verificationSectionLine,
} from "../adapters/_shared/src/verification_config";

/** tests/ → plugins/dev-process-toolkit → plugins → repo root. */
const repoRoot = join(import.meta.dir, "..", "..", "..");
const claudeMdPath = join(repoRoot, "CLAUDE.md");
const skillsDir = join(repoRoot, ".claude", "skills");
const frPath = join(repoRoot, "specs", "frs", "STE-506.md");
const archivedFrPath = join(
  repoRoot,
  "specs",
  "frs",
  "archive",
  "STE-506.md",
);
const implementSkillPath = join(
  repoRoot,
  "plugins",
  "dev-process-toolkit",
  "skills",
  "implement",
  "SKILL.md",
);

function readFr(): string {
  // Archive fallback: this FR's own pins must survive its archival commit.
  const path = existsSync(frPath) ? frPath : archivedFrPath;
  return readFileSync(path, "utf-8");
}

/** The FR's prose — everything after the closing frontmatter delimiter. */
function frBody(): string {
  const fr = readFr();
  const opener = fr.match(/^---\n[\s\S]*?\n---\n/);
  return opener ? fr.slice(opener[0].length) : fr;
}

describe("STE-506 AC.2 — the slug heuristic is deliberately NOT widened", () => {
  test("SLUG_PATTERNS is EXACTLY drive/check/verify — a widening fails here", () => {
    expect([...SLUG_PATTERNS]).toEqual(["drive", "check", "verify"]);
  });

  test("conformance- and smoke-shaped slugs match no pattern", () => {
    for (const slug of [
      "conformance-loop",
      "smoke-test",
      "conformance-report",
      "smoke-test-fixtures",
    ]) {
      expect({
        slug,
        matched: SLUG_PATTERNS.some((p) => slug.includes(p)),
      }).toEqual({ slug, matched: false });
    }
  });

  test("this repo really ships both driver skills, and discovery still sees NONE of them", () => {
    // Half one: the directory is genuinely populated, so the empty scan below
    // is evidence of non-match rather than of an empty `.claude/skills`.
    const slugs = readdirSync(skillsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    expect(slugs).toContain("conformance-loop");
    expect(slugs).toContain("smoke-test");
    for (const slug of slugs) {
      expect(existsSync(join(skillsDir, slug, "SKILL.md"))).toBe(true);
    }

    // Half two: the real scanner, on the real repo, returns nothing. This is
    // the fact AC.3 exists to answer — and it goes red if anyone "fixes"
    // discovery by widening the net or by marking a shipped skill.
    expect(scanCandidateCheckSkills(repoRoot)).toEqual([]);
  });

  test("the FR records WHY the widening was rejected", () => {
    const fr = readFr();
    expect(fr.toLowerCase()).toContain("discovery must never guess");
    // The rejected alternative is named concretely, not gestured at.
    const design = fr.split("## Technical Design")[1] ?? "";
    expect(design).toContain("conformance");
    expect(design).toContain("smoke");
    expect(design).toMatch(/never guess/i);
  });
});

describe("STE-506 AC.3 — this repo declares its own `## Verification` block", () => {
  test("the block exists and parses without throwing", () => {
    expect(verificationSectionLine(claudeMdPath)).not.toBeNull();
    const config = readVerificationConfig(claudeMdPath);
    expect(config).toEqual({
      verifySkill: "smoke-test",
      verifyMode: "manual",
      runCmd: "none",
      e2eCmd: null,
    });
  });

  test("the named verify_skill RESOLVES on disk — a name, not a wish", () => {
    const declared = readVerificationConfig(claudeMdPath).verifySkill;
    expect(declared).not.toBeNull();
    expect(existsSync(join(skillsDir, declared!, "SKILL.md"))).toBe(true);
  });

  test("the effective mode is `manual`, and /implement's contract says manual does not auto-run", () => {
    expect(resolveVerifyMode(claudeMdPath)).toBe("manual");
    // The consequence, pinned to the shipped surface: this repo's drivers
    // spawn multi-hour headless `claude -p` chains, so Phase 4b" must not
    // fire one on every FR.
    const implementMd = readFileSync(implementSkillPath, "utf-8");
    expect(implementMd).toContain("does **not** auto-run the skill");
  });

  test("`run_cmd: none` is MEASURED — detectRunnability finds no source on this tree", () => {
    const report = detectRunnability(repoRoot);
    expect(report.sources.map((s) => s.source)).toEqual([]);
    expect(report.runnable).toBe(false);
    // The declaration and the detector must agree: `none` is the honest value
    // only while nothing fires. If a `dev` script or a `## Running` heading
    // ever lands here, this goes red and the block must be rewritten.
    expect(readVerificationConfig(claudeMdPath).runCmd).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// STE-506 AC.3, second pass — the DURABLE record.
//
// `verify_mode` is the single most consequential value in the declared block:
// it decides whether /implement's Phase 4b" fires a driver on every FR. Until
// now the reasoning for choosing `manual` lived ONLY as a comment in this test
// file. This repo's own rule is that the durable record belongs in the FR, and
// a comment in a test is not that record — it is invisible to /spec-review, to
// the archive, and to anyone reading why the toolkit exempted itself.
//
// Each leg below is separately falsifiable. In particular the COST leg is
// deliberately split out: an FR that merely mentions `manual` and explains the
// convenience would pass a bare mention pin while hiding the exemption.
// ---------------------------------------------------------------------------

describe("STE-506 AC.3 — the FR records the `verify_mode: manual` decision", () => {
  test("the FR states, in its body, that the block declares `verify_mode: manual`", () => {
    expect(frBody()).toMatch(/verify_mode:\s*`?manual/);
  });

  test("the FR gives the REASON: a multi-hour headless `claude -p` chain, so a per-FR auto-run is infeasible", () => {
    const body = frBody();
    // The driver shape, named concretely — not "the drivers are slow".
    expect(body).toMatch(/claude -p/);
    expect(body).toMatch(/multi-hour|hours|long-running/i);
    // And the conclusion that follows from it.
    expect(body).toMatch(/infeasible|impractical|not viable|cannot run/i);
    expect(body).toMatch(/\bper[- ]FR\b|every FR|each FR/i);
  });

  test("the FR rejects `advisory` by name, and says why it is strictly worse", () => {
    const body = frBody();
    expect(body).toMatch(/\badvisory\b/);
    // Three separate consequences, all of which the rejection turns on.
    expect(body).toMatch(/auto-?fire|auto-?run|fire automatically/i);
    expect(body).toMatch(/time ?out|times out|timing out|timed out/i);
    expect(body).toMatch(/ignore|ignoring/i);
  });

  test("the FR records the COST plainly — the exemption, not just the win", () => {
    const body = frBody();
    // Named as a cost, in the FR's own voice.
    expect(body).toMatch(/\bcost\b/i);
    // The thing that never happens.
    expect(body).toMatch(/never\s+(?:actually\s+)?(?:drive|drives|driven|run|runs|fires)/i);
    // And the split stated explicitly: one half discharged, the other not.
    // A self-congratulatory note ("the toolkit now declares its own contract")
    // satisfies neither of these two.
    expect(body).toMatch(/declaration half/i);
    expect(body).toMatch(/drive half/i);
  });
});

describe("STE-506 — the Technical Design matches what actually shipped", () => {
  test("the retired prediction is gone from the FR entirely", () => {
    const fr = readFr();
    // Shipped reality contradicts both halves of the original sentence: the
    // block carries verify_skill + verify_mode + run_cmd, not `verify_skill`
    // alone. Asserted over the WHOLE FR so the claim cannot be relocated to a
    // different section and survive.
    expect(fr).not.toMatch(/likely honest answer/i);
    expect(fr).not.toMatch(/carry\s+`?verify_skill`?\s+alone/i);
  });

  test("the design describes the THREE keys the block really declares", () => {
    const design = frBody().split("## Technical Design")[1] ?? "";
    expect(design).not.toBe("");
    for (const key of ["verify_skill", "verify_mode", "run_cmd"]) {
      expect({ key, present: design.includes(key) }).toEqual({
        key,
        present: true,
      });
    }
    // Cross-check against the shipped block itself: the keys the FR describes
    // are the keys that parse out of CLAUDE.md, so the two cannot drift apart.
    const config = readVerificationConfig(claudeMdPath);
    expect(config.verifySkill).not.toBeNull();
    expect(config.verifyMode).not.toBeNull();
    expect(config.runCmd).not.toBeNull();
  });
});
