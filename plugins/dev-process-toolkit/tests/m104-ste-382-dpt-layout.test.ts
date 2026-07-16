// M104 STE-382 AC-STE-382.1 + AC-STE-382.6 — `.dpt` layout consolidation sweep.
//
// AC-STE-382.1 — `dpt_paths.ts` is the sole composer of `.dpt` path literals.
//   The consumer modules named in the FR's five-literals table must derive
//   their paths from it, so none of them may carry a legacy `.dpt-locks` /
//   `.dev-process` string of its own.
// AC-STE-382.6 — remaining literals swept:
//   (a) `bun_zero_match_placeholder.ts` SKIP_DIRS carries `.dpt` (not
//       `.dpt-locks`) — asserted behaviorally, since SKIP_DIRS is private;
//   (b) `token_stats_render.ts` comments no longer name `.dev-process/`.
//
// SCOPE CARVE-OUT (STE-382 § Notes, /implement Phase 1 operator decision):
// `skills/setup/SKILL.md:158` — the `.dev-process/` root-`.gitignore` append —
// is DELIBERATELY EXCLUDED here. STE-383 AC-STE-383.3 retires that exact line;
// STE-382 cannot clean it without doing STE-383's job. AC-STE-382.6 is
// satisfied at the milestone end state (post-STE-383). Do not add a
// setup/SKILL.md assertion to this file.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBunZeroMatchPlaceholderProbe } from "../adapters/_shared/src/bun_zero_match_placeholder";
import { dptRoot, scratchDir } from "../adapters/_shared/src/dpt_paths";

const SHARED_SRC = join(import.meta.dir, "..", "adapters", "_shared", "src");

const read = (rel: string): string => readFileSync(join(SHARED_SRC, rel), "utf-8");

// -----------------------------------------------------------------------------
// AC-STE-382.1 — consumers derive from dpt_paths; no legacy literals survive
// -----------------------------------------------------------------------------

// The five-literal table from the FR's § Technical Design, plus the two comment
// sites AC-STE-382.6 names.
const CONSUMER_MODULES = [
  "local_provider.ts",
  "token_usage.ts",
  "spec_research_result_shape.ts",
  "deps_research_result_shape.ts",
  "bun_zero_match_placeholder.ts",
  "token_stats_render.ts",
];

describe("AC-STE-382.1 — no consumer module carries a legacy `.dpt-locks` literal", () => {
  for (const mod of CONSUMER_MODULES) {
    test(`${mod} names no .dpt-locks path`, () => {
      expect(read(mod)).not.toContain(".dpt-locks");
    });
  }
});

describe("AC-STE-382.6 — no consumer module carries a legacy `.dev-process` literal", () => {
  for (const mod of CONSUMER_MODULES) {
    test(`${mod} names no .dev-process path (prose, comments, or code)`, () => {
      expect(read(mod)).not.toContain(".dev-process");
    });
  }
});

describe("AC-STE-382.1 — dpt_paths is the single source the consumers import", () => {
  for (const mod of ["local_provider.ts", "token_usage.ts", "spec_research_result_shape.ts", "deps_research_result_shape.ts"]) {
    test(`${mod} imports from ./dpt_paths`, () => {
      expect(read(mod)).toMatch(/from\s+"\.\/dpt_paths"/);
    });
  }
});

// -----------------------------------------------------------------------------
// AC-STE-382.6(a) — SKIP_DIRS carries `.dpt`, proven behaviorally
//
// SKIP_DIRS is module-private, so the assertion drives the probe instead of
// reading the constant. A `*.test.ts` living inside the toolkit's own `.dpt/`
// tree (research scratch routinely holds arbitrary persisted text) must not
// count as the project's test file — if the walker descends into `.dpt/`, a
// stray scratch file silences the zero-match placeholder gate.
// -----------------------------------------------------------------------------

describe("AC-STE-382.6 — the probe walk skips the whole `.dpt/` tree", () => {
  test("a stray *.test.ts under .dpt/scratch/ does NOT satisfy the placeholder gate", async () => {
    const root = mkdtempSync(join(tmpdir(), "ste-382-skipdirs-"));
    try {
      writeFileSync(join(root, "bun.lock"), "{}\n");
      // The ONLY *.test.ts in the project lives inside the .dpt/ scratch tree.
      const scratch = scratchDir(root, "01HZZZQK5T0000000000000001");
      mkdirSync(scratch, { recursive: true });
      writeFileSync(
        join(scratch, "stray.test.ts"),
        'import { test, expect } from "bun:test";\ntest("x", () => expect(1).toBe(1));\n',
      );

      // `.dpt` is skipped ⇒ the project still has no test file and no marker
      // ⇒ the zero-match violation fires. Were `.dpt` walked, the stray file
      // would mask it and this project would gate green with zero real tests.
      const report = await runBunZeroMatchPlaceholderProbe(root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.note).toMatch(/bun\.lock/);
      expect(report.violations[0]!.reason).toMatch(/no test files/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a stray marker comment under .dpt/ does NOT satisfy the placeholder gate", async () => {
    const root = mkdtempSync(join(tmpdir(), "ste-382-skipdirs-marker-"));
    try {
      writeFileSync(join(root, "bun.lock"), "{}\n");
      const ledger = join(dptRoot(root), "ledger");
      mkdirSync(ledger, { recursive: true });
      // The marker string can appear verbatim in persisted research/ledger
      // text. Inside `.dpt/` it must carry no gate-satisfying weight.
      writeFileSync(join(ledger, "notes.md"), "// Bun zero-match workaround\n");

      const report = await runBunZeroMatchPlaceholderProbe(root);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]!.reason).toMatch(/no zero-match placeholder marker/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a real co-located *.test.ts outside .dpt/ still satisfies the gate", async () => {
    // Control: the skip is scoped to `.dpt/`, it does not blind the walker.
    const root = mkdtempSync(join(tmpdir(), "ste-382-skipdirs-control-"));
    try {
      writeFileSync(join(root, "bun.lock"), "{}\n");
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(
        join(root, "src", "real.test.ts"),
        'import { test, expect } from "bun:test";\ntest("x", () => expect(1).toBe(1));\n',
      );
      const report = await runBunZeroMatchPlaceholderProbe(root);
      expect(report.violations).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
