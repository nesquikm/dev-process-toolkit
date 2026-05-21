// STE-322 (M84) — Skill prose hygiene: step labels + phantom ship-milestone
// feature.
//
// Covers AC-STE-322.{1, 2, 3, 4, 5}. Per-AC test groups assert the
// byte-checkable invariants:
//
//   - AC.1: skills/implement/SKILL.md Phase 1 substep labels renamed so the
//     disk order is also the alphabetic order. `0.d Tracker-mode probe`
//     becomes the LAST step (renamed to `0.f`); the old `0.e Claim
//     verification` becomes `0.d`; the old `0.f Project-milestone attach`
//     becomes `0.e`. Lockstep inbound-reference sweep: every inbound
//     reference is updated.
//   - AC.2: docs/ship-milestone-reference.md drops the phantom "README
//     structure-count refresh" claim; replaced with a one-line note that
//     /ship-milestone does NOT auto-refresh structure counts (cross-refs
//     STE-315 probe #57 as the byte-checkable enforcement layer).
//   - AC.3: skills/spec-archive/SKILL.md Single-FR archival list is
//     renumbered 1, 2, 3, 4 (currently 1, 2, 3, 5 — step 4 absent).
//   - AC.4: skills/ship-milestone/SKILL.md drops the "step 8 above" dangling
//     reference; rewrites to reference Pre-flight refusal #1 "Unshipped FRs".
//   - AC.5: tests/skill-nfr-1-length.test.ts comment cites STE-305 (M81) for
//     the 350→351 cap raise (currently mis-attributes to STE-303);
//     tests/setup-tracker-config-write.test.ts updates the AC label from
//     `AC-303.2` to `AC-STE-303.2`.

import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pluginRoot = join(import.meta.dir, "..");
const repoRoot = join(pluginRoot, "..", "..");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

// ---------------------------------------------------------------------------
// AC-STE-322.1 — skills/implement/SKILL.md Phase 1 substep relabeling +
// lockstep inbound-reference sweep.
// ---------------------------------------------------------------------------

describe("AC-STE-322.1 — implement SKILL.md Phase 1 substep labels in alphabetic disk order", () => {
  const body = read(join(pluginRoot, "skills", "implement", "SKILL.md"));

  test("step `0.d Claim verification` heading exists (formerly `0.e Claim verification`)", () => {
    // The Phase 1-exit self-check used to be labeled `0.e Claim verification`.
    // Post-rename it sits at `0.d` (disk-second-after-0.c). The bullet header
    // shape: `- **0.d Claim verification ...**`.
    expect(body).toMatch(/0\.d Claim verification/);
  });

  test("step `0.e Project-milestone attach` heading exists (formerly `0.f`)", () => {
    // Old `0.f Project-milestone attach` rename target is `0.e`.
    expect(body).toMatch(/0\.e Project-milestone attach/);
  });

  test("step `0.f Tracker-mode probe` heading exists (formerly trailing `0.d`)", () => {
    // The terminal Phase 1 step (Schema L tracker-mode probe) used to be
    // labeled `0.d` despite landing LAST on disk; post-rename it is `0.f`.
    expect(body).toMatch(/0\.f Tracker-mode probe/);
  });

  test("no `0.e Claim verification` or `0.f Project-milestone attach` headings linger", () => {
    // These two literal labels are the pre-rename forms — they MUST be gone.
    expect(body).not.toMatch(/0\.e Claim verification/);
    expect(body).not.toMatch(/0\.f Project-milestone attach/);
  });

  test("no `0.d Tracker-mode probe` heading lingers (the old trailing label)", () => {
    expect(body).not.toMatch(/0\.d Tracker-mode probe/);
  });

  test("SKILL.md self-reference `skips 0.c/0.e/0.f` updated to the renamed labels", () => {
    // The original L40 prose lists the three steps the --code-only path
    // skips: claim, claim verification, project-milestone attach. Under the
    // rename those are 0.c, 0.d, 0.e (not 0.c/0.e/0.f).
    expect(body).toMatch(/skips 0\.c\/0\.d\/0\.e/);
    expect(body).not.toMatch(/skips 0\.c\/0\.e\/0\.f/);
  });

  test("0.f Tracker-mode probe section still cross-references `step 0.c` for claimLock timing", () => {
    // The "Record `updatedAt` (post-claimLock)" sub-bullet inside the
    // Tracker-mode probe section names step 0.c (claimLock) — that token
    // is invariant across the rename.
    expect(body).toMatch(/After step 0\.c `claimLock`/);
  });

  test("docs/implement-tracker-mode.md `step 0.c` reference resolves to claimLock unchanged", () => {
    // Inbound ref (b) from the AC: docs/implement-tracker-mode.md:22 says
    // "after step 0.c claimLock has returned ..." — 0.c (claim) is invariant.
    const tm = read(join(pluginRoot, "docs", "implement-tracker-mode.md"));
    expect(tm).toMatch(/after.*step 0\.c.*claimLock/);
  });

  test("docs/implement-reference.md `step 0.d` ref now reads `step 0.f` (Tracker-mode probe location)", () => {
    // Inbound ref (c) from the AC: docs/implement-reference.md L49 originally
    // says "the probe already ran in step 0.d; the value is in-session." The
    // probe is the Tracker-mode probe, which post-rename is 0.f.
    const ref = read(join(pluginRoot, "docs", "implement-reference.md"));
    expect(ref).toMatch(/the probe already ran in step 0\.f/);
    expect(ref).not.toMatch(/the probe already ran in step 0\.d/);
  });

  test("docs/implement-reference.md `step 0.c` (continue at claim) reference is invariant", () => {
    // Inbound ref (c): docs/implement-reference.md L71 cites "step 0.c" for
    // continuing Phase 1 at claim. 0.c is the claim step, unchanged.
    const ref = read(join(pluginRoot, "docs", "implement-reference.md"));
    expect(ref).toMatch(/continue Phase 1 at step 0\.c/);
  });

  test("adapters/jira.md `step 0.c` reference is invariant (claim, unchanged)", () => {
    // Inbound ref (d): adapters/jira.md:101 cites step 0.c on the release
    // side. 0.c is the claim step, unchanged by the rename.
    const jira = read(join(pluginRoot, "adapters", "jira.md"));
    expect(jira).toMatch(/Phase 1 step 0\.c/);
  });

  test("adapters/linear.md `step 0.c` (claim) + `step 0.e` (project-milestone attach) references resolve", () => {
    // Inbound ref (d): adapters/linear.md:96 cites step 0.c (claim, invariant)
    // and L202 cites step 0.f (was project-milestone attach, post-rename 0.e).
    const linear = read(join(pluginRoot, "adapters", "linear.md"));
    expect(linear).toMatch(/Phase 1 step 0\.c/);
    // The project-milestone attach citation moves from 0.f to 0.e.
    expect(linear).toMatch(/Phase 1 step 0\.e/);
    expect(linear).not.toMatch(/Phase 1 step 0\.f when the adapter declares `project_milestone/);
  });

  test("skills/gate-check/SKILL.md `step 0.c` references resolve unchanged (claim is invariant)", () => {
    // Inbound ref (e): skills/gate-check/SKILL.md:67 has two `step 0.c`
    // citations — both point at the claim step, which is invariant.
    const gc = read(join(pluginRoot, "skills", "gate-check", "SKILL.md"));
    const matches = gc.match(/Phase 1 step 0\.c/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  test("tests/implement-tracker-claim-runbook.test.ts helper renamed: `step0eVerifySection` → `step0dVerifySection`", () => {
    // Inbound ref (f): the helper function name + the literal indexOf string
    // both move from 0.e to 0.d.
    const src = read(
      join(pluginRoot, "tests", "implement-tracker-claim-runbook.test.ts"),
    );
    expect(src).toMatch(/step0dVerifySection/);
    expect(src).not.toMatch(/step0eVerifySection/);
    expect(src).toMatch(/indexOf\("0\.d Claim verification"\)/);
    expect(src).not.toMatch(/indexOf\("0\.e Claim verification"\)/);
  });

  test("tests/updated-at-timing.test.ts comments + test name updated to reflect renamed labels", () => {
    // Inbound ref (f): updated-at-timing.test.ts L8 / L21 / L23 reference
    // step 0.c (invariant) and step 0.d. The "labels updatedAt recording as
    // post-claimLock" assertion lives inside the Tracker-mode probe section,
    // which post-rename is 0.f.
    const src = read(join(pluginRoot, "tests", "updated-at-timing.test.ts"));
    // The L21 test-name string reads "implement SKILL.md step 0.d labels
    // updatedAt ..." → must move to step 0.f (the new Tracker-mode probe
    // label location).
    expect(src).toMatch(/SKILL\.md step 0\.f labels updatedAt/);
    expect(src).not.toMatch(/SKILL\.md step 0\.d labels updatedAt/);
    // The L23 comment ("sub-bullet of step 0.d") moves to "step 0.f".
    expect(src).toMatch(/sub-bullet of step 0\.f/);
    expect(src).not.toMatch(/sub-bullet of step 0\.d/);
  });

  test("repo-wide grep: every `step 0.[a-f]` reference resolves to a renamed label", () => {
    // The FR's promise: `grep -rnE "step 0\\.[a-f]"
    // plugins/dev-process-toolkit/{skills,docs,adapters,tests}` shows
    // every reference resolves. We assert that no surviving reference
    // names a step that no longer exists in implement/SKILL.md.
    // Pre-rename the obvious failure modes are:
    //   - "step 0.d" pointing at the Tracker-mode probe (now 0.f)
    //   - "step 0.e" pointing at Claim verification (now 0.d)
    //   - "step 0.f" pointing at Project-milestone attach (now 0.e)
    let grep = "";
    try {
      grep = execSync(
        "grep -rnE 'step 0\\.[a-f]' plugins/dev-process-toolkit/skills plugins/dev-process-toolkit/docs plugins/dev-process-toolkit/adapters plugins/dev-process-toolkit/tests",
        { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      );
    } catch {
      grep = "";
    }
    const lines = grep.split("\n").filter((l) => l.length > 0);
    // Drop matches inside this very test file (it intentionally documents
    // both pre- and post-rename labels in its prose).
    const filtered = lines.filter(
      (l) => !l.includes("m84-ste-322-skill-prose-hygiene.test.ts"),
    );
    // Specific stale-pointer probes:
    //   (a) "step 0.d" claiming to be a tracker-mode probe ref — gone.
    //   (b) "step 0.e Claim verification" — gone.
    //   (c) "step 0.f Project-milestone attach" — gone.
    for (const line of filtered) {
      expect(line).not.toMatch(/step 0\.d.*Tracker-mode probe/);
      expect(line).not.toMatch(/step 0\.e.*Claim verification/);
      expect(line).not.toMatch(/step 0\.f.*Project-milestone attach/);
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-322.2 — docs/ship-milestone-reference.md drops the phantom "README
// structure-count refresh" claim.
// ---------------------------------------------------------------------------

describe("AC-STE-322.2 — ship-milestone-reference.md drops phantom README structure-count refresh", () => {
  const body = read(join(pluginRoot, "docs", "ship-milestone-reference.md"));

  test("no `## README structure-count refresh` heading lingers", () => {
    // The phantom-feature section heading is gone.
    expect(body).not.toMatch(/^## README structure-count refresh\s*$/m);
  });

  test("no prose asserting `/ship-milestone` walks {skills,docs,agents} for structure counts", () => {
    // The body sentence: "/ship-milestone walks these directories and emits
    // current counts into the ## Structure section of README.md" is gone.
    expect(body).not.toMatch(
      /\/ship-milestone.*walks these directories and emits current counts/,
    );
    expect(body).not.toMatch(
      /emits current counts into the `?## Structure`? section/,
    );
  });

  test("no `Shape-change guard` block for the phantom structure-counts refresh", () => {
    // The "If the ## Structure block's shape has changed ..." paragraph
    // describes the phantom-feature's failure-mode handling. Drop it.
    expect(body).not.toMatch(/Shape-change guard.*## Structure/);
  });

  test("replacement note explicitly states /ship-milestone does NOT auto-refresh structure counts", () => {
    // The AC requires a one-line note documenting the absence of the
    // feature, with a cross-reference to STE-315's probe #57.
    expect(body).toMatch(
      /does not.*auto-refresh.*README structure counts|README structure counts.*not.*auto-refresh/i,
    );
  });

  test("replacement note cross-references STE-315 (probe #57 `public_surface_count_drift`)", () => {
    // The cross-reference is unidirectional: this doc points at STE-315.
    expect(body).toMatch(/STE-315/);
    expect(body).toMatch(/public_surface_count_drift|probe #57/);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-322.3 — skills/spec-archive/SKILL.md Single-FR archival list
// renumbered to 1, 2, 3, 4 (currently 1, 2, 3, 5 — step 4 absent).
// ---------------------------------------------------------------------------

describe("AC-STE-322.3 — spec-archive SKILL.md Single-FR archival list is renumbered 1..4", () => {
  const body = read(join(pluginRoot, "skills", "spec-archive", "SKILL.md"));

  test("Single-FR archival list contains a `4. Run the Post-Archive Drift Check` line (not `5.`)", () => {
    // The fourth item ("Run the Post-Archive Drift Check") used to be
    // labeled `5.`. Post-fix it is `4.`.
    expect(body).toMatch(/^4\. Run the Post-Archive Drift Check/m);
    expect(body).not.toMatch(/^5\. Run the Post-Archive Drift Check/m);
  });

  test("awk-shaped sequential-numbering check: no item under Single-FR archival is mis-numbered", () => {
    // Locate the Single-FR archival list and scan its top-level numbered
    // items (those starting at column 0). Expect strictly sequential 1..N.
    const startIdx = body.indexOf("**Single-FR archival**");
    expect(startIdx).toBeGreaterThan(-1);
    // End the slice at the next top-level **bold-marker** list (the
    // Milestone-group archival block).
    const endIdx = body.indexOf("**Milestone-group archival**", startIdx);
    expect(endIdx).toBeGreaterThan(startIdx);
    const slice = body.slice(startIdx, endIdx);
    // Collect top-level numbered items (lines starting with `\d. `).
    const labels: number[] = [];
    for (const line of slice.split("\n")) {
      const m = line.match(/^([1-9][0-9]?)\. /);
      if (m) labels.push(Number(m[1]));
    }
    expect(labels.length).toBeGreaterThanOrEqual(4);
    // Expect strictly 1, 2, 3, 4 with no skipped indices.
    for (let i = 0; i < labels.length; i++) {
      expect(labels[i]).toBe(i + 1);
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-322.4 — skills/ship-milestone/SKILL.md drops the "step 8 above"
// dangling reference and rewrites to "Pre-flight refusal #1".
// ---------------------------------------------------------------------------

describe("AC-STE-322.4 — ship-milestone SKILL.md drops `step 8 above` dangling reference", () => {
  const body = read(join(pluginRoot, "skills", "ship-milestone", "SKILL.md"));

  test("no `step <N> above` phrasing lingers anywhere in the SKILL.md", () => {
    // The AC's promise: `grep -nE "step [0-9]+ above" SKILL.md` returns 0.
    expect(body).not.toMatch(/step [0-9]+ above/);
  });

  test("the unshipped-FRs prose now references `Pre-flight refusal #1`", () => {
    // Suggested replacement: "must be archived after Pre-flight refusal #1
    // above (Unshipped FRs)" — accept either ordering.
    expect(body).toMatch(/Pre-flight refusal #1/);
  });

  test("the surviving prose mentions `Unshipped FRs` near the reference for clarity", () => {
    // The rewrite ties the bare "Pre-flight refusal #1" to the named refusal
    // so reviewers don't have to count refusals to identify the target.
    const idx = body.indexOf("Pre-flight refusal #1");
    expect(idx).toBeGreaterThan(-1);
    // Look in a 200-char window around the citation for the disambiguator.
    const window = body.slice(Math.max(0, idx - 100), idx + 200);
    expect(window).toMatch(/Unshipped FRs/);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-322.5 — test-file comment / AC-label hygiene.
// ---------------------------------------------------------------------------

describe("AC-STE-322.5 — test file comment + AC-label hygiene", () => {
  test("skill-nfr-1-length.test.ts comment cites STE-305 for the 350→351 cap raise", () => {
    // Pre-fix: the comment mis-attributes 350 → 351 to STE-303 (M79).
    // Post-fix: STE-305 (M81) is named for the cap raise; STE-303 / M79 is
    // either dropped or re-purposed as the /setup MCP best-match citation.
    const src = read(join(pluginRoot, "tests", "skill-nfr-1-length.test.ts"));
    expect(src).toMatch(/350\s*[→-]+\s*351.*STE-305|STE-305.*350\s*[→-]+\s*351/);
    // The mis-attribution to STE-303 for the cap raise must be gone.
    expect(src).not.toMatch(/350\s*→\s*351 in M79 \(STE-303\)/);
  });

  test("skill-nfr-1-length.test.ts: M81 context survives the rewrite", () => {
    // STE-305 ships in M81 — the comment should anchor on the new milestone.
    const src = read(join(pluginRoot, "tests", "skill-nfr-1-length.test.ts"));
    expect(src).toMatch(/M81/);
  });

  test("setup-tracker-config-write.test.ts AC label uses `AC-STE-303.2` (not `AC-303.2`)", () => {
    // Pre-fix: the test name reads `(AC-303.2)`.
    // Post-fix: `(AC-STE-303.2)` matching the canonical `STE-` prefix.
    const src = read(
      join(pluginRoot, "tests", "setup-tracker-config-write.test.ts"),
    );
    expect(src).toMatch(/\(AC-STE-303\.2\)/);
    expect(src).not.toMatch(/\(AC-303\.2\)/);
  });
});
