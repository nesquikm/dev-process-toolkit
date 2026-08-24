// Unit tests for readVerificationConfig (STE-347 AC-STE-347.1).
//
// Covers the Schema-L-style `## Verification` section parser: defaults
// (CLAUDE.md absent, section absent, individual key absent), each explicit
// verify_mode, closed-key-set rejection (keys other than verify_skill /
// verify_mode inside the section throw), out-of-set verify_mode value
// rejection, and `verify_skill: visual-check` acceptance. Mirrors the
// shape of docs_config.test.ts — same isolation pattern (mkdtemp per
// test), same thrown-error assertions.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MalformedVerificationConfigError,
  readVerificationConfig,
  resolveVerifyMode,
} from "./verification_config";

let work: string;
let claudeMdPath: string;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "dpt-verifc-"));
  claudeMdPath = join(work, "CLAUDE.md");
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

const DEFAULTS = {
  verifySkill: null,
  verifyMode: "advisory",
  runCmd: null,
  e2eCmd: null,
};

/** CLAUDE.md body with the given `## Verification` section lines. */
function claudeMdWithVerification(sectionLines: string): string {
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

describe("readVerificationConfig — defaults (AC-STE-347.1)", () => {
  test("absent CLAUDE.md file returns { verifySkill: null, verifyMode: 'advisory' }", () => {
    // No file written at claudeMdPath.
    expect(readVerificationConfig(claudeMdPath)).toEqual(DEFAULTS);
  });

  test("missing `## Verification` section returns defaults", () => {
    writeFileSync(
      claudeMdPath,
      `# Project\n\n## Task Tracking\n\nmode: linear\n`,
    );
    expect(readVerificationConfig(claudeMdPath)).toEqual(DEFAULTS);
  });

  test("empty `## Verification` section (no keys) returns defaults", () => {
    writeFileSync(claudeMdPath, claudeMdWithVerification(""));
    expect(readVerificationConfig(claudeMdPath)).toEqual(DEFAULTS);
  });

  test("verify_mode absent defaults to 'advisory' (verify_skill still read)", () => {
    writeFileSync(
      claudeMdPath,
      claudeMdWithVerification("verify_skill: glacy-drive"),
    );
    expect(readVerificationConfig(claudeMdPath)).toEqual({
      verifySkill: "glacy-drive",
      verifyMode: "advisory",
      runCmd: null,
      e2eCmd: null,
    });
  });

  test("verify_skill absent defaults to null (verify_mode still read)", () => {
    writeFileSync(
      claudeMdPath,
      claudeMdWithVerification("verify_mode: blocking"),
    );
    expect(readVerificationConfig(claudeMdPath)).toEqual({
      verifySkill: null,
      verifyMode: "blocking",
      runCmd: null,
      e2eCmd: null,
    });
  });
});

describe("readVerificationConfig — explicit modes (AC-STE-347.1)", () => {
  test("verify_mode: advisory parses", () => {
    writeFileSync(
      claudeMdPath,
      claudeMdWithVerification(
        "verify_skill: glacy-drive\nverify_mode: advisory",
      ),
    );
    expect(readVerificationConfig(claudeMdPath)).toEqual({
      verifySkill: "glacy-drive",
      verifyMode: "advisory",
      runCmd: null,
      e2eCmd: null,
    });
  });

  test("verify_mode: blocking parses", () => {
    writeFileSync(
      claudeMdPath,
      claudeMdWithVerification(
        "verify_skill: glacy-drive\nverify_mode: blocking",
      ),
    );
    expect(readVerificationConfig(claudeMdPath)).toEqual({
      verifySkill: "glacy-drive",
      verifyMode: "blocking",
      runCmd: null,
      e2eCmd: null,
    });
  });

  test("verify_mode: manual parses", () => {
    writeFileSync(
      claudeMdPath,
      claudeMdWithVerification(
        "verify_skill: glacy-drive\nverify_mode: manual",
      ),
    );
    expect(readVerificationConfig(claudeMdPath)).toEqual({
      verifySkill: "glacy-drive",
      verifyMode: "manual",
      runCmd: null,
      e2eCmd: null,
    });
  });

  test("the literal `visual-check` is an accepted verify_skill value", () => {
    writeFileSync(
      claudeMdPath,
      claudeMdWithVerification(
        "verify_skill: visual-check\nverify_mode: advisory",
      ),
    );
    expect(readVerificationConfig(claudeMdPath)).toEqual({
      verifySkill: "visual-check",
      verifyMode: "advisory",
      runCmd: null,
      e2eCmd: null,
    });
  });
});

describe("readVerificationConfig — closed-set rejection (AC-STE-347.1)", () => {
  test("out-of-closed-set key inside the section throws MalformedVerificationConfigError", () => {
    writeFileSync(
      claudeMdPath,
      claudeMdWithVerification(
        "verify_skill: glacy-drive\nverify_timeout: 30",
      ),
    );
    expect(() => readVerificationConfig(claudeMdPath)).toThrow(
      MalformedVerificationConfigError,
    );
  });

  test("out-of-set key error carries key + value", () => {
    writeFileSync(
      claudeMdPath,
      claudeMdWithVerification("verify_timeout: 30"),
    );
    try {
      readVerificationConfig(claudeMdPath);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(MalformedVerificationConfigError);
      const e = err as MalformedVerificationConfigError;
      expect(e.name).toBe("MalformedVerificationConfigError");
      expect(e.key).toBe("verify_timeout");
      expect(e.value).toBe("30");
    }
  });

  test("out-of-set verify_mode value throws MalformedVerificationConfigError", () => {
    writeFileSync(
      claudeMdPath,
      claudeMdWithVerification("verify_mode: strict"),
    );
    expect(() => readVerificationConfig(claudeMdPath)).toThrow(
      MalformedVerificationConfigError,
    );
  });

  test("out-of-set verify_mode error carries key + value (NFR-10 remedy shape)", () => {
    writeFileSync(
      claudeMdPath,
      claudeMdWithVerification("verify_mode: BLOCKING"),
    );
    try {
      readVerificationConfig(claudeMdPath);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(MalformedVerificationConfigError);
      const e = err as MalformedVerificationConfigError;
      expect(e.key).toBe("verify_mode");
      expect(e.value).toBe("BLOCKING");
      expect(e.message).toContain("verify_mode");
      expect(e.message).toContain("BLOCKING");
    }
  });
});

describe("readVerificationConfig — section boundaries", () => {
  test("section terminates at next heading (keys below `## Other` are ignored)", () => {
    const md = `# Project

## Verification

verify_mode: manual

## Other

verify_mode: garbage
bogus_key: x
`;
    writeFileSync(claudeMdPath, md);
    expect(readVerificationConfig(claudeMdPath)).toEqual({
      verifySkill: null,
      verifyMode: "manual",
      runCmd: null,
      e2eCmd: null,
    });
  });

  test("keys outside the section (e.g. Task Tracking's `mode:`) never trip the closed set", () => {
    // claudeMdWithVerification always includes `mode: none` under
    // `## Task Tracking` — an out-of-closed-set key that must be
    // ignored because it sits outside `## Verification`.
    writeFileSync(
      claudeMdPath,
      claudeMdWithVerification("verify_skill: glacy-drive"),
    );
    expect(readVerificationConfig(claudeMdPath)).toEqual({
      verifySkill: "glacy-drive",
      verifyMode: "advisory",
      runCmd: null,
      e2eCmd: null,
    });
  });
});

// ---------------------------------------------------------------------------
// M131 STE-503 — the closed key set widens from two to four: `run_cmd` and
// `e2e_cmd` join `verify_skill` and `verify_mode`.
//
// Every exact-record assertion ABOVE this line was widened, not weakened, when
// this FR landed: each one now also pins `runCmd: null` / `e2eCmd: null`, which
// is the AC.3 compatibility clause ("both absent keeps today's behaviour
// exactly") asserted on the shipped call sites rather than restated in prose.
// ---------------------------------------------------------------------------

describe("readVerificationConfig — run_cmd / e2e_cmd (AC-STE-503.1)", () => {
  test("run_cmd parses to its literal value", () => {
    writeFileSync(
      claudeMdPath,
      claudeMdWithVerification("run_cmd: bun run dev"),
    );
    expect(readVerificationConfig(claudeMdPath).runCmd).toBe("bun run dev");
  });

  test("e2e_cmd parses to its literal value", () => {
    writeFileSync(
      claudeMdPath,
      claudeMdWithVerification("e2e_cmd: bun test:e2e"),
    );
    expect(readVerificationConfig(claudeMdPath).e2eCmd).toBe("bun test:e2e");
  });

  test("all four keys parse together into one record", () => {
    writeFileSync(
      claudeMdPath,
      claudeMdWithVerification(
        [
          "verify_skill: glacy-drive",
          "verify_mode: blocking",
          "run_cmd: flutter run -d chrome",
          "e2e_cmd: flutter test integration_test",
        ].join("\n"),
      ),
    );
    expect(readVerificationConfig(claudeMdPath)).toEqual({
      verifySkill: "glacy-drive",
      verifyMode: "blocking",
      runCmd: "flutter run -d chrome",
      e2eCmd: "flutter test integration_test",
    });
  });

  test("a command value containing a colon survives intact", () => {
    // The Schema-L line regex splits on the FIRST colon only; everything to
    // the right of it is the value, colons included.
    writeFileSync(
      claudeMdPath,
      claudeMdWithVerification("run_cmd: docker compose up -d && curl :8080"),
    );
    expect(readVerificationConfig(claudeMdPath).runCmd).toBe(
      "docker compose up -d && curl :8080",
    );
  });

  test("run_cmd / e2e_cmd below the next heading are outside the section", () => {
    const md = `# Project

## Verification

run_cmd: bun run dev

## Other

e2e_cmd: never-read
`;
    writeFileSync(claudeMdPath, md);
    expect(readVerificationConfig(claudeMdPath)).toEqual({
      verifySkill: null,
      verifyMode: "advisory",
      runCmd: "bun run dev",
      e2eCmd: null,
    });
  });
});

// ---------------------------------------------------------------------------
// M131 STE-505 — `resolveVerifyMode` returns the EFFECTIVE verify_mode.
//
// `readVerificationConfig` keeps returning the DECLARED record, byte-for-byte
// as it does today (the exact-record assertions above are the proof, and one
// below re-pins the shape on a run_cmd-declared file specifically). The
// run_cmd-keyed default is a second, derived question, so it gets a second
// export rather than a widened record:
//
//   declared `verify_mode`        ⇒ that value, always
//   else run_cmd declared, non-empty, not `none` ⇒ `blocking`
//   else                                          ⇒ `advisory`
//
// The middle rule's "non-empty" clause matches /gate-check probe #80's
// `hasRunCmdAnswer` (`runCmd !== null && runCmd.trim() !== ""`): a bare
// `run_cmd:` is an omission that merely looks like an answer, and the two
// layers must not disagree about it.
// ---------------------------------------------------------------------------

/** CLAUDE.md with NO `## Verification` section at all. */
const NO_SECTION_MD = `# Project

## Task Tracking

mode: none
`;

describe("resolveVerifyMode — advisory stays the default off the run_cmd path (AC-STE-505.2)", () => {
  test("absent CLAUDE.md resolves to advisory", () => {
    expect(resolveVerifyMode(join(work, "nope.md"))).toBe("advisory");
  });

  test("CLAUDE.md with no ## Verification section resolves to advisory", () => {
    writeFileSync(claudeMdPath, NO_SECTION_MD);
    expect(resolveVerifyMode(claudeMdPath)).toBe("advisory");
  });

  test("run_cmd absent + verify_mode absent resolves to advisory (today's behaviour)", () => {
    writeFileSync(
      claudeMdPath,
      claudeMdWithVerification("verify_skill: glacy-drive"),
    );
    expect(resolveVerifyMode(claudeMdPath)).toBe("advisory");
  });

  test("run_cmd: none + verify_mode absent resolves to advisory", () => {
    writeFileSync(claudeMdPath, claudeMdWithVerification("run_cmd: none"));
    expect(resolveVerifyMode(claudeMdPath)).toBe("advisory");
  });

  test("a bare `run_cmd:` is NOT a declaration — resolves to advisory", () => {
    writeFileSync(claudeMdPath, claudeMdWithVerification("run_cmd:"));
    // Sanity: the parser really did see the key and store the empty string,
    // so this test is about the RESOLVER's treatment of it, not about the
    // key being skipped upstream.
    expect(readVerificationConfig(claudeMdPath).runCmd).toBe("");
    expect(resolveVerifyMode(claudeMdPath)).toBe("advisory");
  });

  test("a whitespace-only `run_cmd:` is NOT a declaration — resolves to advisory", () => {
    writeFileSync(claudeMdPath, claudeMdWithVerification("run_cmd:    "));
    expect(resolveVerifyMode(claudeMdPath)).toBe("advisory");
  });

  test("e2e_cmd alone does not trigger the blocking default", () => {
    // The gate is `run_cmd` — "this project can be brought up" — not the
    // presence of any command key.
    writeFileSync(claudeMdPath, claudeMdWithVerification("e2e_cmd: bun test:e2e"));
    expect(resolveVerifyMode(claudeMdPath)).toBe("advisory");
  });
});

describe("resolveVerifyMode — a declared-runnable project defaults to blocking (AC-STE-505.2)", () => {
  test("run_cmd: bun run dev + verify_mode absent resolves to blocking", () => {
    writeFileSync(claudeMdPath, claudeMdWithVerification("run_cmd: bun run dev"));
    expect(resolveVerifyMode(claudeMdPath)).toBe("blocking");
  });

  test("a multi-word run_cmd with flags still resolves to blocking", () => {
    writeFileSync(
      claudeMdPath,
      claudeMdWithVerification("run_cmd: flutter run -d chrome"),
    );
    expect(resolveVerifyMode(claudeMdPath)).toBe("blocking");
  });

  test("an EXPLICIT advisory still wins over the run_cmd default", () => {
    // The FR's supersession argument turns on this: `verify_mode: advisory`
    // remains explicitly settable, so the promote-when-stable workflow the
    // authoring guide teaches survives the reversal. Without this case the
    // flip would overreach.
    writeFileSync(
      claudeMdPath,
      claudeMdWithVerification(
        ["verify_mode: advisory", "run_cmd: bun run dev"].join("\n"),
      ),
    );
    expect(resolveVerifyMode(claudeMdPath)).toBe("advisory");
  });

  test("an explicit manual still wins over the run_cmd default", () => {
    writeFileSync(
      claudeMdPath,
      claudeMdWithVerification(
        ["verify_mode: manual", "run_cmd: bun run dev"].join("\n"),
      ),
    );
    expect(resolveVerifyMode(claudeMdPath)).toBe("manual");
  });

  test("an explicit blocking is unchanged by the new default", () => {
    writeFileSync(
      claudeMdPath,
      claudeMdWithVerification(
        ["verify_mode: blocking", "run_cmd: bun run dev"].join("\n"),
      ),
    );
    expect(resolveVerifyMode(claudeMdPath)).toBe("blocking");
  });

  test("an explicit blocking survives run_cmd: none", () => {
    writeFileSync(
      claudeMdPath,
      claudeMdWithVerification(
        ["verify_mode: blocking", "run_cmd: none"].join("\n"),
      ),
    );
    expect(resolveVerifyMode(claudeMdPath)).toBe("blocking");
  });
});

describe("resolveVerifyMode — AC-STE-505.5 measured against the shipped reader", () => {
  // "byte-identical" asserted, not assumed: on every path that is NOT
  // declared-runnable, the new resolver must agree with the value
  // readVerificationConfig has always returned.
  const UNCHANGED_SECTIONS: readonly string[] = [
    "verify_skill: glacy-drive",
    "run_cmd: none",
    "run_cmd:",
    "e2e_cmd: bun test:e2e",
    "verify_mode: advisory",
    "verify_mode: blocking",
    "verify_mode: manual",
    ["verify_mode: manual", "run_cmd: none"].join("\n"),
    ["verify_skill: glacy-drive", "verify_mode: blocking", "e2e_cmd: none"].join(
      "\n",
    ),
  ];

  for (const section of UNCHANGED_SECTIONS) {
    test(`resolver agrees with the shipped reader for [${section.replace(/\n/g, " | ")}]`, () => {
      writeFileSync(claudeMdPath, claudeMdWithVerification(section));
      expect(resolveVerifyMode(claudeMdPath)).toBe(
        readVerificationConfig(claudeMdPath).verifyMode,
      );
    });
  }

  test("the ONLY divergence is the declared-runnable + undeclared-mode cell", () => {
    writeFileSync(claudeMdPath, claudeMdWithVerification("run_cmd: bun run dev"));
    expect(readVerificationConfig(claudeMdPath).verifyMode).toBe("advisory");
    expect(resolveVerifyMode(claudeMdPath)).toBe("blocking");
  });

  test("readVerificationConfig's record shape is unchanged by this FR", () => {
    // The declared-vs-defaulted distinction lives INSIDE the module. Widening
    // this record would redden the whole-record pins above and STE-503's.
    writeFileSync(claudeMdPath, claudeMdWithVerification("run_cmd: bun run dev"));
    expect(readVerificationConfig(claudeMdPath)).toEqual({
      verifySkill: null,
      verifyMode: "advisory",
      runCmd: "bun run dev",
      e2eCmd: null,
    });
  });
});

describe("resolveVerifyMode — malformed input (AC-STE-505.2)", () => {
  test("an out-of-set verify_mode value still throws, not silently defaults", () => {
    writeFileSync(
      claudeMdPath,
      claudeMdWithVerification(
        ["verify_mode: Blocking", "run_cmd: bun run dev"].join("\n"),
      ),
    );
    expect(() => resolveVerifyMode(claudeMdPath)).toThrow(
      MalformedVerificationConfigError,
    );
  });

  test("an out-of-closed-set key still throws", () => {
    writeFileSync(
      claudeMdPath,
      claudeMdWithVerification(
        ["verify_command: bun run dev", "run_cmd: bun run dev"].join("\n"),
      ),
    );
    expect(() => resolveVerifyMode(claudeMdPath)).toThrow(
      MalformedVerificationConfigError,
    );
  });
});
