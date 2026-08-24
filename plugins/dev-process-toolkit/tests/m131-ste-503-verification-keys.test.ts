// M131 STE-503 — the `## Verification` block declares how to run the project.
//
// WHAT IS BROKEN, measured on this tree at authoring time (2026-08-24, v2.69.0):
//
//   * `adapters/_shared/src/verification_config.ts` closes the section's key set
//     at exactly two: the `switch (key)` has cases for `verify_skill` and
//     `verify_mode` and a `default:` that THROWS. A project that writes
//     `run_cmd: bun run dev` therefore does not get an ignored key — it gets a
//     hard `MalformedVerificationConfigError`, and `/implement` refuses the
//     whole config.
//   * `VerificationConfig` has two fields. There is nowhere for a run command
//     to live even if the parser accepted it.
//   * `grep -c "renderVerificationSection" adapters/_shared/src/` → 0. Nothing
//     can write the block back out, so "survives parse and re-render" (the FR's
//     ## Testing clause) has no subject at all today.
//   * The key regex is `/^([a-z_]+):\s*(.*)$/` — `[a-z_]+` has no digit class,
//     so the line `e2e_cmd: ...` does not even MATCH and is silently skipped.
//     A widening that only adds a `case "e2e_cmd"` to the switch leaves that
//     line invisible; the AC.1 e2e leg below fails on exactly that mistake.
//
// TEST STRATEGY, and why no half of it is a tautology.
//
//   * AC.2 IS A DISTINCTION, SO IT IS ASSERTED IN BOTH DIRECTIONS. A test that
//     only checks `run_cmd: none` parses to `"none"` passes under an
//     implementation that also turns ABSENCE into `"none"` — which is precisely
//     the collapse STE-504's probe cannot survive. Every `none` assertion below
//     is paired with the absent-key assertion on the same record shape, and the
//     two are compared to each other with `not.toEqual`.
//   * AC.5 IS PINNED AS A WHOLE RECORD, NOT AS A PARAPHRASE. The two-key legs
//     assert the FULL returned object with `toEqual`, so an implementation that
//     defaults `runCmd` to `""`, `undefined`, or `"none"` fails them. Asserting
//     only `verifySkill`/`verifyMode` would pass under all three and prove
//     nothing about "byte-identically to today".
//   * FALSIFIABILITY IS EXECUTED, NOT CLAIMED. `assertDeclaresNone` is one
//     predicate applied twice: once to the real rendered block (must pass) and
//     once to the block rendered from a COLLAPSED record — the defect expressed
//     as data — which must THROW. A pin that cannot fail is not a pin.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MalformedVerificationConfigError,
  readVerificationConfig,
  renderVerificationSection,
  resolveVerifyMode,
  verificationSectionLine,
} from "../adapters/_shared/src/verification_config";

let work: string;
let claudeMdPath: string;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "dpt-ste503-"));
  claudeMdPath = join(work, "CLAUDE.md");
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

/** A realistic CLAUDE.md carrying the given `## Verification` body lines. */
function claudeMdWith(sectionLines: string): string {
  return `# Project

Description.

## Task Tracking

mode: none

## Verification

${sectionLines}

## Rules

- keep tests green
`;
}

/** Write a CLAUDE.md with the given section body and parse it. */
function parseSection(sectionLines: string) {
  writeFileSync(claudeMdPath, claudeMdWith(sectionLines));
  return readVerificationConfig(claudeMdPath);
}

// ---------------------------------------------------------------------------
// AC-STE-503.1 — `## Verification` accepts `run_cmd` and `e2e_cmd`; the closed
// key set becomes exactly four.
// ---------------------------------------------------------------------------

describe("AC-STE-503.1 — the closed key set is exactly four", () => {
  test("run_cmd is accepted and reaches the record", () => {
    expect(parseSection("run_cmd: bun run dev").runCmd).toBe("bun run dev");
  });

  test("e2e_cmd is accepted and reaches the record (the key regex must allow the digit)", () => {
    // Guard against the half-fix: adding `case "e2e_cmd"` to the switch while
    // leaving the `[a-z_]+` key pattern alone leaves this line unmatched, and
    // the value silently null.
    expect(parseSection("e2e_cmd: bun run e2e").e2eCmd).toBe("bun run e2e");
  });

  test("all four keys parse together — the positive half of the closed set", () => {
    const cfg = parseSection(
      [
        "verify_skill: glacy-drive",
        "verify_mode: blocking",
        "run_cmd: flutter run -d chrome",
        "e2e_cmd: flutter test integration_test",
      ].join("\n"),
    );
    expect(cfg).toEqual({
      verifySkill: "glacy-drive",
      verifyMode: "blocking",
      runCmd: "flutter run -d chrome",
      e2eCmd: "flutter test integration_test",
    });
  });

  test("each of the four keys is independently readable in isolation", () => {
    expect(parseSection("verify_skill: glacy-drive").verifySkill).toBe(
      "glacy-drive",
    );
    expect(parseSection("verify_mode: manual").verifyMode).toBe("manual");
    expect(parseSection("run_cmd: npm start").runCmd).toBe("npm start");
    expect(parseSection("e2e_cmd: npx playwright test").e2eCmd).toBe(
      "npx playwright test",
    );
  });
});

// ---------------------------------------------------------------------------
// AC-STE-503.2 — `run_cmd: none` is the explicit declaration that the project
// cannot be run, and is a valid value rather than an absent key.
// ---------------------------------------------------------------------------

describe("AC-STE-503.2 — `none` is a declared answer, absence is no answer", () => {
  test("run_cmd: none parses to the literal string 'none' (not null, not an error)", () => {
    const cfg = parseSection("run_cmd: none");
    expect(cfg.runCmd).toBe("none");
  });

  test("an absent run_cmd parses to null", () => {
    const cfg = parseSection("verify_mode: advisory");
    expect(cfg.runCmd).toBeNull();
  });

  test("`none` and absent are distinguishable on the same record shape", () => {
    // The load-bearing assertion for STE-504's probe: a consumer must be able
    // to tell "answered in the negative" from "never answered".
    const declaredNone = parseSection("run_cmd: none");
    const absent = parseSection("verify_mode: advisory");
    expect(declaredNone).not.toEqual(absent);
    expect(declaredNone.runCmd).not.toBe(absent.runCmd);
    expect(typeof declaredNone.runCmd).toBe("string");
    expect(absent.runCmd).toBeNull();
  });

  test("e2e_cmd: none is likewise a value, not an absence", () => {
    expect(parseSection("e2e_cmd: none").e2eCmd).toBe("none");
    expect(parseSection("run_cmd: bun run dev").e2eCmd).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC-STE-503.3 — `readVerificationConfig` returns the new keys; both absent
// keeps today's behaviour exactly.
// ---------------------------------------------------------------------------

describe("AC-STE-503.3 — new keys returned; both-absent is unchanged", () => {
  test("an absent CLAUDE.md still returns the shipped defaults, now with null commands", () => {
    // No file written.
    expect(readVerificationConfig(claudeMdPath)).toEqual({
      verifySkill: null,
      verifyMode: "advisory",
      runCmd: null,
      e2eCmd: null,
    });
  });

  test("an absent `## Verification` section still returns the shipped defaults", () => {
    writeFileSync(claudeMdPath, `# Project\n\n## Task Tracking\n\nmode: none\n`);
    expect(readVerificationConfig(claudeMdPath)).toEqual({
      verifySkill: null,
      verifyMode: "advisory",
      runCmd: null,
      e2eCmd: null,
    });
  });

  test("absence is null — never undefined, never the empty string", () => {
    const cfg = parseSection("verify_skill: glacy-drive");
    expect(cfg.runCmd).toBeNull();
    expect(cfg.e2eCmd).toBeNull();
    expect(cfg.runCmd).not.toBeUndefined();
    expect(cfg.e2eCmd).not.toBeUndefined();
    expect(cfg.runCmd).not.toBe("");
    expect(cfg.e2eCmd).not.toBe("");
    // The keys must be PRESENT on the record, so a consumer can read them.
    expect(Object.keys(cfg).sort()).toEqual([
      "e2eCmd",
      "runCmd",
      "verifyMode",
      "verifySkill",
    ]);
  });

  test("declaring the new keys does not disturb the old ones", () => {
    const cfg = parseSection(
      "verify_skill: visual-check\nverify_mode: manual\nrun_cmd: none",
    );
    expect(cfg.verifySkill).toBe("visual-check");
    expect(cfg.verifyMode).toBe("manual");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-503.4 — a key outside the four is still a config error.
// ---------------------------------------------------------------------------

describe("AC-STE-503.4 — the set is closed at four, not opened", () => {
  test("a fifth key inside the section throws MalformedVerificationConfigError", () => {
    writeFileSync(
      claudeMdPath,
      claudeMdWith(
        [
          "verify_skill: glacy-drive",
          "verify_mode: blocking",
          "run_cmd: bun run dev",
          "e2e_cmd: bun run e2e",
          "build_cmd: bun run build",
        ].join("\n"),
      ),
    );
    expect(() => readVerificationConfig(claudeMdPath)).toThrow(
      MalformedVerificationConfigError,
    );
  });

  test("the error carries the offending key + value (NFR-10 remedy shape)", () => {
    writeFileSync(claudeMdPath, claudeMdWith("build_cmd: bun run build"));
    try {
      readVerificationConfig(claudeMdPath);
      throw new Error("expected a MalformedVerificationConfigError");
    } catch (err) {
      expect(err).toBeInstanceOf(MalformedVerificationConfigError);
      const e = err as MalformedVerificationConfigError;
      expect(e.key).toBe("build_cmd");
      expect(e.value).toBe("bun run build");
    }
  });

  test("the remedy names the widened set, so the operator sees all four", () => {
    writeFileSync(claudeMdPath, claudeMdWith("run_command: bun run dev"));
    try {
      readVerificationConfig(claudeMdPath);
      throw new Error("expected a MalformedVerificationConfigError");
    } catch (err) {
      const e = err as MalformedVerificationConfigError;
      expect(e.message).toContain("verify_skill");
      expect(e.message).toContain("verify_mode");
      expect(e.message).toContain("run_cmd");
      expect(e.message).toContain("e2e_cmd");
    }
  });

  test("a near-miss of a NEW key is rejected, not silently coerced", () => {
    // `runcmd` / `e2e-cmd` are typos of real keys; silently ignoring them is
    // exactly the failure mode the closed set exists to prevent.
    writeFileSync(claudeMdPath, claudeMdWith("runcmd: bun run dev"));
    expect(() => readVerificationConfig(claudeMdPath)).toThrow(
      MalformedVerificationConfigError,
    );
  });

  test("an out-of-set verify_mode value is still rejected at the new width", () => {
    writeFileSync(
      claudeMdPath,
      claudeMdWith("verify_mode: strict\nrun_cmd: bun run dev"),
    );
    expect(() => readVerificationConfig(claudeMdPath)).toThrow(
      MalformedVerificationConfigError,
    );
  });
});

// ---------------------------------------------------------------------------
// AC-STE-503.5 — an existing two-key block parses byte-identically to today.
// ---------------------------------------------------------------------------

describe("AC-STE-503.5 — the pre-migration two-key block is unchanged", () => {
  test("a real two-key block yields the exact full record it did before", () => {
    // The block below is the shipped authoring shape from
    // docs/verification-skills.md, copied verbatim. The assertion is the WHOLE
    // record — an implementation that defaults the new keys to "", undefined,
    // or "none" fails here.
    const cfg = parseSection("verify_skill: glacy-drive\nverify_mode: blocking");
    expect(cfg).toEqual({
      verifySkill: "glacy-drive",
      verifyMode: "blocking",
      runCmd: null,
      e2eCmd: null,
    });
  });

  test("two-key block with verify_mode omitted still defaults to advisory", () => {
    const cfg = parseSection("verify_skill: glacy-drive");
    expect(cfg).toEqual({
      verifySkill: "glacy-drive",
      verifyMode: "advisory",
      runCmd: null,
      e2eCmd: null,
    });
  });

  test("every shipped verify_mode literal round-trips unchanged", () => {
    for (const mode of ["advisory", "blocking", "manual"] as const) {
      expect(parseSection(`verify_skill: v\nverify_mode: ${mode}`)).toEqual({
        verifySkill: "v",
        verifyMode: mode,
        runCmd: null,
        e2eCmd: null,
      });
    }
  });
});

// ---------------------------------------------------------------------------
// Round-trip — the FR's ## Testing clause: `none` survives parse and re-render
// distinguishably from absence.
// ---------------------------------------------------------------------------

/**
 * The predicate under falsifiability test: a rendered `## Verification` block
 * declares an un-runnable project iff it carries a literal `run_cmd: none`
 * line. Applied to real output AND to the collapsed defect below.
 */
function assertDeclaresNone(rendered: string): void {
  const lines = rendered.split("\n").map((l) => l.trim());
  if (!lines.includes("run_cmd: none")) {
    throw new Error(
      `rendered block does not declare run_cmd: none —\n${rendered}`,
    );
  }
}

/** Lines of a rendered block that declare the given key. */
function keyLines(rendered: string, key: string): string[] {
  return rendered
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith(`${key}:`));
}

describe("round-trip — renderVerificationSection", () => {
  test("renders a `## Verification` heading and the declared keys", () => {
    const rendered = renderVerificationSection(
      parseSection(
        "verify_skill: glacy-drive\nverify_mode: blocking\nrun_cmd: bun run dev\ne2e_cmd: bun run e2e",
      ),
    );
    expect(rendered).toContain("## Verification");
    expect(keyLines(rendered, "verify_skill")).toEqual([
      "verify_skill: glacy-drive",
    ]);
    expect(keyLines(rendered, "verify_mode")).toEqual([
      "verify_mode: blocking",
    ]);
    expect(keyLines(rendered, "run_cmd")).toEqual(["run_cmd: bun run dev"]);
    expect(keyLines(rendered, "e2e_cmd")).toEqual(["e2e_cmd: bun run e2e"]);
  });

  test("render(parse(block with `none`)) still carries run_cmd: none", () => {
    const rendered = renderVerificationSection(parseSection("run_cmd: none"));
    expect(keyLines(rendered, "run_cmd")).toEqual(["run_cmd: none"]);
  });

  test("render(parse(block without run_cmd)) emits NO run_cmd line at all", () => {
    const rendered = renderVerificationSection(
      parseSection("verify_skill: glacy-drive\nverify_mode: advisory"),
    );
    expect(keyLines(rendered, "run_cmd")).toEqual([]);
    expect(rendered).not.toContain("run_cmd");
  });

  test("the two rendered blocks are not the same text", () => {
    const withNone = renderVerificationSection(parseSection("run_cmd: none"));
    const without = renderVerificationSection(
      parseSection("verify_mode: advisory"),
    );
    expect(withNone).not.toBe(without);
  });

  test("re-parsing a rendered block reproduces the record it came from", () => {
    for (const body of [
      "run_cmd: none",
      "verify_skill: glacy-drive\nverify_mode: blocking\nrun_cmd: bun run dev\ne2e_cmd: bun run e2e",
      "verify_skill: visual-check\nverify_mode: manual",
      "e2e_cmd: none",
    ]) {
      const original = parseSection(body);
      const rendered = renderVerificationSection(original);
      const roundTripPath = join(work, "ROUNDTRIP.md");
      writeFileSync(roundTripPath, `# Project\n\n${rendered}\n`);
      expect(readVerificationConfig(roundTripPath)).toEqual(original);
    }
  });

  test("FALSIFIABILITY: the `none` predicate throws on the collapsed record", () => {
    // Real output must satisfy the predicate...
    const real = renderVerificationSection(parseSection("run_cmd: none"));
    expect(() => assertDeclaresNone(real)).not.toThrow();

    // ...and the defect expressed as data — `none` collapsed back to absence —
    // must fail it. Without this leg the predicate above could be vacuous.
    const collapsed = renderVerificationSection({
      ...parseSection("run_cmd: none"),
      runCmd: null,
    });
    expect(() => assertDeclaresNone(collapsed)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// LINE-ENDING FOLD — the defect this milestone's own tests uncovered on the
// parser STE-503 widened.
//
// MEASURED ON THIS TREE BEFORE WRITING (2026-08-24, v2.69.0), by constructing
// each fixture and calling the real exports:
//
//   readVerificationConfig(LF   full 4-key block) -> {verifySkill:"visual-check",
//       verifyMode:"blocking", runCmd:"bun run dev", e2eCmd:"bun test:e2e"}
//   readVerificationConfig(CRLF same bytes)       -> DEFAULTS. All four keys lost.
//   verificationSectionLine(LF) -> 3 ; (CRLF) -> null
//   resolveVerifyMode(LF run_cmd-only) -> "blocking" ; (CRLF) -> "advisory"
//   readVerificationConfig(BOM, heading on line 1) -> DEFAULTS
//   readVerificationConfig(lone-CR)               -> DEFAULTS
//   readVerificationConfig(CRLF with `verify_kill:`) -> DID NOT THROW
//
// THE MECHANISM: `parseVerificationSection` does `md.split("\n")` and then
// `sectionIndex` locates the section by EXACT WHOLE-LINE EQUALITY
// (`l === "## Verification"`). Under CRLF every element keeps a trailing `\r`,
// so the heading is `"## Verification\r"` and matches nothing; a BOM welds
// itself to a first-line heading with the same result. The section is not
// mis-parsed, it is INVISIBLE — and invisible reads back as the defaults, so
// a project that declared `verify_skill` and `run_cmd` gets verification
// silently DISABLED. That is the failure pointing the wrong way: the projects
// that bothered to declare a check are exactly the ones that lose it.
//
// The repo already ships the fix as `normalizeFrontmatterSource` (strips BOM,
// folds CRLF and lone CR to LF, preserves line COUNT so reported line numbers
// stay true). Siblings in this same milestone already fold —
// `scan_candidate_check_skills.ts` calls it; `detect_runnability.ts` strips a
// trailing `\r` per line. This parser is the one that was missed.
//
// WHY THESE LEGS CANNOT GO VACUOUS:
//
//   * Every cross-encoding leg asserts the WHOLE record with `toEqual` against
//     BOTH the LF result AND an independent literal. Comparing only to the LF
//     result would pass if a "fix" broke both sides identically; comparing only
//     to a literal would not prove the two encodings agree. Both, or neither.
//   * The line-number leg does not hardcode a magic 9. It asserts the reported
//     line against the CRLF fixture's OWN `split("\r\n")`, so the pin says
//     "the number you returned indexes the real heading" — an off-by-one from
//     a fold that changes line count fails it, and the pin survives any edit
//     to the `claudeMdWith` preamble.
//   * The LF-unchanged guard asserts literals, not "same as before". A fold
//     that rewrote the common case would satisfy an equality between two
//     freshly-computed values and fail these.
// ---------------------------------------------------------------------------

/** The full four-key body — every key the closed set admits, all populated. */
const FULL_BODY = [
  "verify_skill: visual-check",
  "verify_mode: blocking",
  "run_cmd: bun run dev",
  "e2e_cmd: bun test:e2e",
].join("\n");

/** The record `FULL_BODY` must produce, stated independently of any parse. */
const FULL_RECORD = {
  verifySkill: "visual-check",
  verifyMode: "blocking",
  runCmd: "bun run dev",
  e2eCmd: "bun test:e2e",
};

const BOM = "﻿";

/** Write `text` re-encoded with `eol` (LF source in, chosen ending out). */
function writeAs(
  name: string,
  lfText: string,
  eol: "\n" | "\r\n" | "\r",
  bom = "",
): string {
  const p = join(work, name);
  writeFileSync(p, bom + (eol === "\n" ? lfText : lfText.replace(/\n/g, eol)));
  return p;
}

describe("## Verification survives non-LF line endings (CRLF / lone CR / BOM)", () => {
  test("CRLF parses to exactly the LF record — all four keys, whole record", () => {
    const lfText = claudeMdWith(FULL_BODY);
    const lf = writeAs("LF.md", lfText, "\n");
    const crlf = writeAs("CRLF.md", lfText, "\r\n");

    const lfConfig = readVerificationConfig(lf);
    const crlfConfig = readVerificationConfig(crlf);

    // Independent literal: neither side may drift, and a partial fold that
    // recovers (say) verify_skill but leaves e2e_cmd null fails here.
    expect(lfConfig).toEqual(FULL_RECORD);
    expect(crlfConfig).toEqual(FULL_RECORD);
    // ...and the two encodings must agree with each other.
    expect(crlfConfig).toEqual(lfConfig);
  });

  test("CRLF: a declared run_cmd with no verify_mode resolves to blocking", () => {
    // STE-505's default — a project that says how to run itself gets driven.
    // Under the unfolded parser the section vanishes, `verify_mode` reads back
    // as the DEFAULTS' `advisory`, and the sibling FR's behaviour is defeated
    // by a line ending rather than by anything the author wrote.
    const lfText = claudeMdWith("run_cmd: bun run dev");
    const lf = writeAs("LF-mode.md", lfText, "\n");
    const crlf = writeAs("CRLF-mode.md", lfText, "\r\n");

    expect(resolveVerifyMode(lf)).toBe("blocking");
    expect(resolveVerifyMode(crlf)).toBe("blocking");
  });

  test("CRLF: an explicit verify_mode still wins over the run_cmd default", () => {
    // Guards the fold against over-reaching: recovering the section must not
    // also change which of STE-505's rules applies.
    const lfText = claudeMdWith("verify_mode: advisory\nrun_cmd: bun run dev");
    const crlf = writeAs("CRLF-explicit.md", lfText, "\r\n");
    expect(resolveVerifyMode(crlf)).toBe("advisory");
  });

  test("BOM: a first-line `## Verification` heading is still found", () => {
    // The BOM's worst case is the heading on line 1, where it welds directly
    // onto the `#` and there is no earlier line to absorb it.
    const lfText = `## Verification\n\n${FULL_BODY}\n\n## Rules\n\n- x\n`;
    const plain = writeAs("NOBOM.md", lfText, "\n");
    const bommed = writeAs("BOM.md", lfText, "\n", BOM);

    expect(readVerificationConfig(plain)).toEqual(FULL_RECORD);
    expect(readVerificationConfig(bommed)).toEqual(FULL_RECORD);
    expect(readVerificationConfig(bommed)).toEqual(
      readVerificationConfig(plain),
    );
    // The positional half must agree too: line 1, not null.
    expect(verificationSectionLine(bommed)).toBe(1);
  });

  test("BOM + CRLF together parse to the same record", () => {
    const lfText = claudeMdWith(FULL_BODY);
    const both = writeAs("BOMCRLF.md", lfText, "\r\n", BOM);
    expect(readVerificationConfig(both)).toEqual(FULL_RECORD);
  });

  test("lone CR (classic Mac) parses to exactly the LF record", () => {
    // Pinned rather than left unspecified: `normalizeFrontmatterSource` folds
    // lone CR, so the behaviour is decided — say so, so a fix that folds only
    // `\r\n` is caught here instead of in a consumer.
    const lfText = claudeMdWith(FULL_BODY);
    const cr = writeAs("CR.md", lfText, "\r");
    expect(readVerificationConfig(cr)).toEqual(FULL_RECORD);
  });

  test("verificationSectionLine reports the true 1-based line on CRLF", () => {
    // `runnability_declared.ts` anchors its violation note at this number, so
    // a null or an off-by-one surfaces to the operator as a wrong `file:line`.
    const lfText = claudeMdWith(FULL_BODY);
    const lf = writeAs("LF-line.md", lfText, "\n");
    const crlfText = lfText.replace(/\n/g, "\r\n");
    const crlf = writeAs("CRLF-line.md", lfText, "\r\n");

    const line = verificationSectionLine(crlf);
    expect(line).not.toBeNull();
    // Self-verifying: the returned number must index the REAL heading in the
    // CRLF fixture's own lines. No magic constant to drift.
    expect(crlfText.split("\r\n")[line! - 1]).toBe("## Verification");
    // ...and both encodings must place it identically.
    expect(line).toBe(verificationSectionLine(lf));
  });

  test("lone CR: the reported line indexes the real heading too", () => {
    const lfText = claudeMdWith(FULL_BODY);
    const cr = writeAs("CR-line.md", lfText, "\r");
    const crText = lfText.replace(/\n/g, "\r");
    const line = verificationSectionLine(cr);
    expect(line).not.toBeNull();
    expect(crText.split("\r")[line! - 1]).toBe("## Verification");
  });

  test("CRLF: an out-of-closed-set key still throws", () => {
    // The closed-set discipline is the reason a typo cannot silently disable a
    // declared check. Today the CRLF file does not throw AT ALL — the section
    // is invisible, so the bad key is never even seen, which is the same
    // silent-disable failure wearing a different hat.
    const lfText = claudeMdWith("verify_skill: visual-check\nverify_kill: oops");
    const crlf = writeAs("CRLF-bad.md", lfText, "\r\n");
    expect(() => readVerificationConfig(crlf)).toThrow(
      MalformedVerificationConfigError,
    );
  });

  test("CRLF: an out-of-set verify_mode VALUE still throws, with clean value", () => {
    // A fold that recovers the section but leaves `\r` on the VALUE would turn
    // `blocking` into `blocking\r` and throw here spuriously — while `Blocking`
    // must genuinely throw. Both directions in one leg.
    const good = writeAs(
      "CRLF-mode-ok.md",
      claudeMdWith("verify_mode: blocking"),
      "\r\n",
    );
    expect(readVerificationConfig(good).verifyMode).toBe("blocking");

    const bad = writeAs(
      "CRLF-mode-bad.md",
      claudeMdWith("verify_mode: Blocking"),
      "\r\n",
    );
    expect(() => readVerificationConfig(bad)).toThrow(
      MalformedVerificationConfigError,
    );
  });

  test("CRLF: section termination at the next heading is unaffected", () => {
    // `/^#{1,4} /` tests the raw line; a `\r` sits at the END so termination
    // itself survives, but the fold must not break it either. A key BELOW the
    // next heading must stay out of the section — otherwise recovering CRLF
    // would swallow the rest of the file and throw on the first foreign key.
    const lfText = `# Project

## Verification

run_cmd: bun run dev

## Task Tracking

mode: none
`;
    const crlf = writeAs("CRLF-term.md", lfText, "\r\n");
    expect(readVerificationConfig(crlf)).toEqual({
      verifySkill: null,
      verifyMode: "advisory",
      runCmd: "bun run dev",
      e2eCmd: null,
    });
  });

  test("CRLF: `run_cmd: none` stays distinguishable from an absent run_cmd", () => {
    // AC-STE-503.2's distinction must survive the fold. A `\r` left on the
    // value would make it `"none\r"`, which STE-504's probe compares against
    // the literal `"none"` and would read as a real command.
    const declaredNone = writeAs(
      "CRLF-none.md",
      claudeMdWith("run_cmd: none"),
      "\r\n",
    );
    const absent = writeAs(
      "CRLF-absent.md",
      claudeMdWith("verify_mode: advisory"),
      "\r\n",
    );
    expect(readVerificationConfig(declaredNone).runCmd).toBe("none");
    expect(readVerificationConfig(absent).runCmd).toBeNull();
    expect(readVerificationConfig(declaredNone)).not.toEqual(
      readVerificationConfig(absent),
    );
    // And `none` must NOT be promoted to blocking.
    expect(resolveVerifyMode(declaredNone)).toBe("advisory");
  });

  test("GUARD: the LF path is unchanged — literals, not recomputed equality", () => {
    // Stated as literals so a fix that quietly rewrites the common case fails
    // here rather than passing an equality between two equally-broken values.
    const lf = writeAs("GUARD.md", claudeMdWith(FULL_BODY), "\n");
    expect(readVerificationConfig(lf)).toEqual(FULL_RECORD);
    expect(verificationSectionLine(lf)).toBe(9);

    const noSection = join(work, "GUARD-none.md");
    writeFileSync(noSection, "# Project\n\nNo section here.\n");
    expect(readVerificationConfig(noSection)).toEqual({
      verifySkill: null,
      verifyMode: "advisory",
      runCmd: null,
      e2eCmd: null,
    });
    expect(verificationSectionLine(noSection)).toBeNull();

    const missing = join(work, "GUARD-missing.md");
    expect(readVerificationConfig(missing)).toEqual({
      verifySkill: null,
      verifyMode: "advisory",
      runCmd: null,
      e2eCmd: null,
    });
    expect(verificationSectionLine(missing)).toBeNull();

    const lfBare = writeAs("GUARD-bare.md", claudeMdWith("run_cmd:"), "\n");
    expect(readVerificationConfig(lfBare).runCmd).toBe("");
    expect(resolveVerifyMode(lfBare)).toBe("advisory");
  });
});
