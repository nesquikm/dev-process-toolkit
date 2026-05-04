// STE-217 — /gate-check probe #28 (plan_verify_line_validity) recognizes
// negative-assertion verify lines and skips the path-existence check.
//
// Negative-assertion verify lines deliberately reference deleted paths to
// assert their absence — the path *should not* exist. The recognized
// shapes (matched in order, any-match short-circuits):
//   1. literal `returns "No such file or directory"` (case-insensitive
//      on the message portion)
//   2. POSIX shell negation prefix `! test -<flag>` (case-sensitive)
//   3. flag substring `--non-existent`
//   4. natural-language `does NOT exist` (case-insensitive on the verb)

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPlanVerifyLineValidityProbe } from "../adapters/_shared/src/plan_verify_line_validity";
import { isNegativeAssertion } from "../adapters/_shared/src/plan_verify_line_validity";

function makePlanFixture(verifyLines: string[]): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "probe-28-neg-assertion-"));
  const planDir = join(root, "specs", "plan");
  mkdirSync(planDir, { recursive: true });
  const tasks = verifyLines.map((v) => `- [x] task\n  verify: ${v}`).join("\n");
  writeFileSync(
    join(planDir, "M99.md"),
    `---\nmilestone: M99\nstatus: active\n---\n\n# M99 — fixture\n\n**Tasks:**\n\n${tasks}\n`,
  );
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("AC-STE-217.1 — isNegativeAssertion recognizer (each pattern)", () => {
  test("pattern 1: `returns \"No such file or directory\"` (case-insensitive on message)", () => {
    expect(isNegativeAssertion('ls src/missing.ts returns "No such file or directory"')).toBe(true);
    expect(isNegativeAssertion('ls foo.ts returns "no such file or directory"')).toBe(true);
  });

  test("pattern 2: `! test -<flag>` (POSIX shell negation, case-sensitive)", () => {
    expect(isNegativeAssertion("! test -f src/.placeholder.test.ts")).toBe(true);
    expect(isNegativeAssertion("! test -e specs/plan/M2.md")).toBe(true);
    // Compound prefix (semicolon, &&, ||).
    expect(isNegativeAssertion("foo; ! test -d build/")).toBe(true);
  });

  test("pattern 3: `--non-existent` flag substring", () => {
    expect(isNegativeAssertion("rg --non-existent foo.txt")).toBe(true);
  });

  test("pattern 4: `does NOT exist` (case-insensitive on the verb)", () => {
    expect(isNegativeAssertion("assert that src/foo.ts does NOT exist on disk")).toBe(true);
    expect(isNegativeAssertion("foo.ts does not exist anymore")).toBe(true);
  });
});

describe("AC-STE-217.2 — partial matches inside compound commands count", () => {
  test("compound shape: `ls foo.ts returns \"No such ...\" && echo done` matches", () => {
    expect(
      isNegativeAssertion('ls foo.ts returns "No such file or directory" && echo done'),
    ).toBe(true);
  });
});

describe("positive-assertion lines do NOT match", () => {
  test("plain `ls foo.ts` ⇒ false (no negative marker)", () => {
    expect(isNegativeAssertion("ls src/foo.ts")).toBe(false);
  });

  test("positive existence `test -f foo.ts` (without leading `!`) ⇒ false", () => {
    expect(isNegativeAssertion("test -f src/foo.ts")).toBe(false);
  });

  test("`Test -f` (capitalized) ⇒ false (POSIX is case-sensitive on `test`)", () => {
    expect(isNegativeAssertion("! Test -f foo.ts")).toBe(false);
  });
});

describe("AC-STE-217.4 — recognizer is total (every input returns boolean)", () => {
  test("empty string ⇒ false (does not throw)", () => {
    expect(isNegativeAssertion("")).toBe(false);
  });

  test("whitespace-only string ⇒ false (does not throw)", () => {
    expect(isNegativeAssertion("   ")).toBe(false);
  });
});

describe("AC-STE-217.3 — probe #28 skips negative-assertion lines", () => {
  test("verify line with `returns \"No such file or directory\"` ⇒ no advisory", async () => {
    const fx = makePlanFixture([
      'ls src/.placeholder.test.ts returns "No such file or directory"',
    ]);
    try {
      const r = await runPlanVerifyLineValidityProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("verify line with `! test -f` ⇒ no advisory", async () => {
    const fx = makePlanFixture(["! test -f src/.placeholder.test.ts"]);
    try {
      const r = await runPlanVerifyLineValidityProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("verify line with `does NOT exist` ⇒ no advisory", async () => {
    const fx = makePlanFixture(["assert src/missing/foo.ts does NOT exist on disk"]);
    try {
      const r = await runPlanVerifyLineValidityProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });
});

describe("AC-STE-217.4 — positive-assertion behavior preserved", () => {
  test("verify line on a missing path with no negative marker ⇒ advisory still fires", async () => {
    const fx = makePlanFixture(["test -f src/missing/foo.ts"]);
    try {
      const r = await runPlanVerifyLineValidityProbe(fx.root);
      expect(r.violations.length).toBeGreaterThan(0);
    } finally {
      fx.cleanup();
    }
  });
});

describe("AC-STE-217.5 — mixed plan: only positive lines surface", () => {
  test("plan with one negative-assertion line + one positive-on-missing ⇒ exactly one advisory", async () => {
    const fx = makePlanFixture([
      'ls src/.placeholder.test.ts returns "No such file or directory"',
      "test -f src/missing/positive.ts",
    ]);
    try {
      const r = await runPlanVerifyLineValidityProbe(fx.root);
      // Only the positive-assertion line on the missing path fires.
      expect(r.violations.length).toBe(1);
      expect(r.violations[0]!.note).toContain("positive.ts");
    } finally {
      fx.cleanup();
    }
  });
});
