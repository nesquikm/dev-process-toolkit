// M_8f07e0 STE-582 — a non-scalar target repo declaration is refused, not
// read as undeclared.
//
// WHAT IS BROKEN, measured on this tree at authoring time (2026-09-10, v2.81.0):
//
//   * `readTargetRepoDeclaration` has ONE non-string clause:
//     `if (typeof raw !== "string") return { declared: false, value: null };`
//     The shipped lenient frontmatter parser turns three different spellings
//     into the SAME empty object before the reader ever sees them:
//
//         target_repo: <block list>  → object {}
//         target_repo: {}            → object {}
//         target_repo:   (bare key)  → object {}
//
//     so a plan that names two repos reads as having named none, and `/deliver`
//     routes the milestone back into the invoking repo with a green chain.
//   * `target_repo: null` reaches the reader as JS `null` (measured), and
//     `typeof null === "object"`. The null sentinel is therefore ALSO caught by
//     the non-string clause today — which is exactly why the new null arm must
//     sit ABOVE the type test. Moved below it, the null control throws.
//   * `grep -c spans_repos adapters/_shared/src/target_repo.ts` → 0, and
//     neither `/deliver` undeclared bullet mentions a refused YAML list.
//
// TEST STRATEGY.
//
//   * The refusal is asserted as CODE on the three measured non-scalar
//     spellings, and the three messages must be BYTE-IDENTICAL — the parser
//     has already destroyed the spelling, so a message that "guesses" one would
//     be lying about two of them.
//   * Each of the four undeclared controls is its OWN test, so a run in which
//     any single one throws is a named red rather than a lost aggregate.
//   * The flow-list path (`[/a, /b]`, which the parser hands through as a
//     string) is pinned UNMOVED: it still reaches the probe and still gets the
//     `could not be located` refusal — never the new one.
//   * The null-arm ordering is pinned twice: once by the behavioural null
//     control, and once by a MODEL of the mutated reader run over the real
//     parser output, proving the mutation would red that control.
//   * `/deliver` prose: the bullet is located by its bold lead, must be unique,
//     must carry the new statement on the SAME line, must gain no module path,
//     and `skills/deliver/SKILL.md` keeps its split-line count.
//
// AC-STE-582.8's full-suite leg (zero failures, skip count unchanged at 15) is
// a gate command, not something a test file can assert about the run it is
// part of; the targeted m129 suite leg IS asserted below via a subprocess.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseFrontmatter } from "../adapters/_shared/src/frontmatter";
import {
  type RepoProbe,
  TargetRepoError,
  readTargetRepoDeclaration,
  routeMilestone,
} from "../adapters/_shared/src/target_repo";

// ===========================================================================
// Paths.
// ===========================================================================

const PLUGIN_ROOT = join(import.meta.dir, "..");
const read = (p: string): string => readFileSync(p, "utf-8");

const TARGET_REPO_SRC_FILE = join(
  PLUGIN_ROOT,
  "adapters",
  "_shared",
  "src",
  "target_repo.ts",
);
const DELIVER_SKILL_FILE = join(PLUGIN_ROOT, "skills", "deliver", "SKILL.md");
const DELIVER_REFERENCE_FILE = join(PLUGIN_ROOT, "docs", "deliver-reference.md");

/** `skills/deliver/SKILL.md` split-line count at HEAD (v2.81.0), measured. */
const DELIVER_SKILL_LINE_COUNT = 262;

// ===========================================================================
// Fixtures.
// ===========================================================================

const BLOCK_LIST = "---\ntarget_repo:\n  - /a\n  - /b\n---\nx";
const EMPTY_MAP = "---\ntarget_repo: {}\n---\nx";
const BARE_KEY = "---\ntarget_repo:\n---\nx";
const FLOW_LIST = "---\ntarget_repo: [/a, /b]\n---";

const UNDECLARED_CONTROLS: ReadonlyArray<readonly [string, string]> = [
  ["target_repo: null", "---\ntarget_repo: null\n---\nx"],
  ["target_repo: ~", "---\ntarget_repo: ~\n---\nx"],
  ['target_repo: ""', '---\ntarget_repo: ""\n---\nx'],
  ["no target_repo key at all", "---\nmilestone: M1\n---\nx"],
];

const SCALAR = "../glacy-app-be";
const SCALAR_LF = `---\ntarget_repo: ${SCALAR}\n---\nx`;
const SCALAR_SOURCES: ReadonlyArray<readonly [string, string]> = [
  ["LF", SCALAR_LF],
  ["CRLF", SCALAR_LF.replace(/\n/g, "\r\n")],
  ["lone CR", SCALAR_LF.replace(/\n/g, "\r")],
  ["BOM-prefixed", `\uFEFF${SCALAR_LF}`],
];

/** A probe that fails the test if the undeclared path consults it at all. */
const THROWING_PROBE: RepoProbe = {
  locate(): string | null {
    throw new Error("probe.locate consulted on an undeclared plan");
  },
  hasToolkit(): boolean {
    throw new Error("probe.hasToolkit consulted on an undeclared plan");
  },
};

/** Run `fn`, returning the thrown error — or failing if nothing was thrown. */
function thrown(fn: () => unknown): Error {
  let result: unknown;
  try {
    result = fn();
  } catch (e) {
    return e as Error;
  }
  throw new Error(
    `expected a throw, got a return value: ${JSON.stringify(result)}`,
  );
}

/** The refusal message a non-scalar spelling produces. */
function refusalFor(body: string): string {
  const err = thrown(() => readTargetRepoDeclaration(body));
  expect(err).toBeInstanceOf(TargetRepoError);
  return err.message;
}

// ===========================================================================
// Premise — the parser really does destroy the spelling.
// ===========================================================================

describe("premise: the shipped parser hands the reader non-strings", () => {
  test("block list, empty map and bare key all reach the reader as the same non-string", () => {
    const shapes = [BLOCK_LIST, EMPTY_MAP, BARE_KEY].map((b) => {
      const raw = parseFrontmatter(b, { lenient: true }).target_repo;
      return { type: typeof raw, isNull: raw === null, json: JSON.stringify(raw) };
    });
    for (const s of shapes) {
      expect(s.type).not.toBe("string");
      expect(s.isNull).toBe(false);
    }
    // All three are indistinguishable by the time the reader sees them — the
    // reason the refusal must enumerate causes instead of naming one.
    expect(new Set(shapes.map((s) => s.json)).size).toBe(1);
  });

  test("the flow list reaches the reader as a STRING, so it takes the probe path", () => {
    const raw = parseFrontmatter(FLOW_LIST, { lenient: true }).target_repo;
    expect(typeof raw).toBe("string");
  });
});

// ===========================================================================
// AC-STE-582.1 — a block list throws the NFR-10 canonical refusal.
// ===========================================================================

describe("AC-STE-582.1 — a block list is refused in the canonical shape", () => {
  test("readTargetRepoDeclaration throws a TargetRepoError on a block list", () => {
    const err = thrown(() => readTargetRepoDeclaration(BLOCK_LIST));
    expect(err).toBeInstanceOf(TargetRepoError);
    expect(err.name).toBe("TargetRepoError");
  });

  test("the message carries Refusing:, Remedy: and Context: each at the start of its own line", () => {
    const msg = refusalFor(BLOCK_LIST);
    const lines = msg.split("\n");
    const refusing = lines.findIndex((l) => l.startsWith("Refusing:"));
    const remedy = lines.findIndex((l) => l.startsWith("Remedy:"));
    const context = lines.findIndex((l) => l.startsWith("Context:"));
    expect(refusing).toBeGreaterThanOrEqual(0);
    expect(remedy).toBeGreaterThanOrEqual(0);
    expect(context).toBeGreaterThanOrEqual(0);
    expect(new Set([refusing, remedy, context]).size).toBe(3);
  });

  test("the refusal does not route through the requires-input envelope", () => {
    const msg = refusalFor(BLOCK_LIST);
    expect(msg).not.toContain("<dpt:requires-input-refused>");
    expect(msg).not.toMatch(/^Verdict:/m);
  });

  test("routeMilestone surfaces the same refusal instead of routing to the invoking repo", () => {
    const err = thrown(() =>
      routeMilestone({
        planBody: BLOCK_LIST,
        invokingRepo: process.cwd(),
        probe: THROWING_PROBE,
      }),
    );
    expect(err).toBeInstanceOf(TargetRepoError);
    expect(err.message).toBe(refusalFor(BLOCK_LIST));
  });
});

// ===========================================================================
// AC-STE-582.2 — the four undeclared controls stay undeclared.
// ===========================================================================

describe("AC-STE-582.2 — every documented undeclared sentinel stays undeclared", () => {
  for (const [label, body] of UNDECLARED_CONTROLS) {
    test(`${label} → { declared: false, value: null }, no throw`, () => {
      let decl: unknown;
      expect(() => {
        decl = readTargetRepoDeclaration(body);
      }).not.toThrow();
      expect(decl).toEqual({ declared: false, value: null });
    });

    test(`${label} still routes to the invoking repo without consulting the probe`, () => {
      const r = routeMilestone({
        planBody: body,
        invokingRepo: "/invoking",
        probe: THROWING_PROBE,
      });
      expect(r.route).toBe("invoking");
      expect(r.declared).toBe(false);
      expect(r.repo).toBe("/invoking");
    });
  }

  // MUTATION NOTE (FR ## Testing): moving the null arm below the type test must
  // red the `target_repo: null` control above. These two tests prove that
  // ordering is load-bearing rather than cosmetic.
  test("mutation premise: `null` reaches the reader as JS null, and typeof null is 'object'", () => {
    const raw = parseFrontmatter(UNDECLARED_CONTROLS[0][1], { lenient: true })
      .target_repo;
    expect(raw).toBeNull();
    expect(typeof raw).toBe("object");
    expect(typeof null).toBe("object");
  });

  test("mutation model: a reader with the null arm BELOW the type test throws on the null control", () => {
    // The Technical Design's two arms, evaluated in either order over the
    // REAL parser output for the null control.
    type Verdict = "undeclared" | "refuse" | null;
    const nullArm = (v: unknown): Verdict =>
      v === undefined || v === null ? "undeclared" : null;
    const typeArm = (v: unknown): Verdict =>
      typeof v !== "string" ? "refuse" : null;
    const evaluate = (
      order: ReadonlyArray<(v: unknown) => Verdict>,
      v: unknown,
    ): Verdict | "scalar" => {
      for (const arm of order) {
        const r = arm(v);
        if (r !== null) return r;
      }
      return "scalar";
    };
    const raw: unknown = parseFrontmatter(UNDECLARED_CONTROLS[0][1], {
      lenient: true,
    }).target_repo;
    expect(evaluate([nullArm, typeArm], raw)).toBe("undeclared"); // designed
    expect(evaluate([typeArm, nullArm], raw)).toBe("refuse"); // mutated
    // …and the shipped reader must behave like the designed order.
    expect(() => readTargetRepoDeclaration(UNDECLARED_CONTROLS[0][1])).not.toThrow();
  });

  test("source order: in readTargetRepoDeclaration the null arm precedes the non-string refusal", () => {
    const src = read(TARGET_REPO_SRC_FILE);
    const start = src.indexOf("export function readTargetRepoDeclaration");
    expect(start).toBeGreaterThanOrEqual(0);
    const next = src.indexOf("\nexport ", start + 1);
    const fn = src.slice(start, next === -1 ? undefined : next);
    const nullArm = fn.search(/raw\s*===?\s*null/);
    const typeArm = fn.search(/typeof\s+raw\s*!==?\s*["']string["']/);
    expect(nullArm).toBeGreaterThanOrEqual(0);
    expect(typeArm).toBeGreaterThanOrEqual(0);
    expect(nullArm).toBeLessThan(typeArm);
    // The non-string arm must now REFUSE, not return undeclared.
    expect(fn).toContain("TargetRepoError");
  });
});

// ===========================================================================
// AC-STE-582.3 — a scalar declaration still reads declared, on every EOL/BOM.
// ===========================================================================

describe("AC-STE-582.3 — a scalar target repo reads declared", () => {
  for (const [label, body] of SCALAR_SOURCES) {
    test(`${label} source → { declared: true, value: "${SCALAR}" }`, () => {
      expect(readTargetRepoDeclaration(body)).toEqual({
        declared: true,
        value: SCALAR,
      });
    });
  }
});

// ===========================================================================
// AC-STE-582.4 — one message, three causes, no guessed spelling.
// ===========================================================================

describe("AC-STE-582.4 — the refusal names no single spelling", () => {
  test("block list, `target_repo: {}` and a bare key each throw TargetRepoError", () => {
    for (const body of [BLOCK_LIST, EMPTY_MAP, BARE_KEY]) {
      expect(() => readTargetRepoDeclaration(body)).toThrow(TargetRepoError);
    }
  });

  test("the three messages are byte-identical", () => {
    const a = refusalFor(BLOCK_LIST);
    const b = refusalFor(EMPTY_MAP);
    const c = refusalFor(BARE_KEY);
    expect(a.length).toBeGreaterThan(0);
    expect(Buffer.from(b).equals(Buffer.from(a))).toBe(true);
    expect(Buffer.from(c).equals(Buffer.from(a))).toBe(true);
  });

  test("that one message names all three causes — a block list, an empty map and a bare key", () => {
    const msg = refusalFor(BLOCK_LIST);
    expect(msg).toMatch(/block[- ]list/i);
    expect(msg).toMatch(/empty map/i);
    expect(msg).toMatch(/bare\b[^\n]{0,40}\bkey/i);
  });
});

// ===========================================================================
// AC-STE-582.5 — the flow-list path is unmoved.
// ===========================================================================

describe("AC-STE-582.5 — the flow list still takes the could-not-be-located path", () => {
  const flowMessage = (): string => {
    const err = thrown(() =>
      routeMilestone({ planBody: FLOW_LIST, invokingRepo: process.cwd() }),
    );
    expect(err).toBeInstanceOf(TargetRepoError);
    return err.message;
  };

  test("routeMilestone on `[/a, /b]` throws TargetRepoError containing `could not be located`", () => {
    expect(flowMessage()).toContain("could not be located");
  });

  test("the flow-list message carries none of the new refusal's vocabulary", () => {
    const msg = flowMessage();
    expect(msg).not.toContain("spans_repos");
    expect(msg).not.toMatch(/empty map/i);
    expect(msg).not.toMatch(/block[- ]list/i);
  });

  test("the flow-list message does not contain the new not-a-single-path refusal text", () => {
    const refusal = refusalFor(BLOCK_LIST);
    const msg = flowMessage();
    const refusingLine = refusal
      .split("\n")
      .find((l) => l.startsWith("Refusing:"));
    expect(refusingLine).toBeDefined();
    expect(msg).not.toContain(refusingLine as string);
    expect(msg).not.toBe(refusal);
  });
});

// ===========================================================================
// AC-STE-582.6 — the Remedy names the spanning key.
// ===========================================================================

describe("AC-STE-582.6 — the Remedy names `spans_repos`", () => {
  test("the thrown message contains `spans_repos`", () => {
    expect(refusalFor(BLOCK_LIST)).toContain("spans_repos");
  });

  test("`spans_repos` sits on the Remedy line", () => {
    const remedy = refusalFor(BLOCK_LIST)
      .split("\n")
      .find((l) => l.startsWith("Remedy:"));
    expect(remedy).toBeDefined();
    expect(remedy as string).toContain("spans_repos");
  });

  test("grep -c 'spans_repos' adapters/_shared/src/target_repo.ts ≥ 1", () => {
    const hits = read(TARGET_REPO_SRC_FILE)
      .split("\n")
      .filter((l) => l.includes("spans_repos")).length;
    expect(hits).toBeGreaterThanOrEqual(1);
  });
});

// ===========================================================================
// AC-STE-582.7 — the copy `/deliver` executes says it.
// ===========================================================================

/** The unique undeclared bullet line, located by its bold lead. */
function undeclaredBullet(body: string): string {
  const hits = body
    .split("\n")
    .filter((l) => l.startsWith("- **No `target_repo:`"));
  expect(hits.length).toBe(1);
  return hits[0] as string;
}

describe("AC-STE-582.7 — the /deliver undeclared bullets state the refusal", () => {
  const surfaces: ReadonlyArray<readonly [string, string]> = [
    ["skills/deliver/SKILL.md", DELIVER_SKILL_FILE],
    ["docs/deliver-reference.md", DELIVER_REFERENCE_FILE],
  ];

  for (const [label, file] of surfaces) {
    test(`${label}: the bold lead still says no key or the null sentinel means the invoking repo`, () => {
      const line = undeclaredBullet(read(file));
      expect(line).toMatch(/`null` sentinel/);
      expect(line).toMatch(/invoking/);
    });

    test(`${label}: the same line says a YAML list under the key is refused`, () => {
      const line = undeclaredBullet(read(file));
      expect(line).toMatch(/YAML list/i);
      expect(line).toMatch(/refus/i);
    });

    test(`${label}: the same line names \`spans_repos\``, () => {
      expect(undeclaredBullet(read(file))).toContain("spans_repos");
    });

    test(`${label}: the line gains no module path`, () => {
      const line = undeclaredBullet(read(file));
      expect(line).not.toMatch(/\.ts\b/);
      expect(line).not.toContain("adapters/");
    });
  }

  test(`skills/deliver/SKILL.md split-line count is unchanged at ${DELIVER_SKILL_LINE_COUNT}`, () => {
    expect(read(DELIVER_SKILL_FILE).split("\n").length).toBe(
      DELIVER_SKILL_LINE_COUNT,
    );
  });
});

// ===========================================================================
// AC-STE-582.8 — the shipped target-repo suite still passes.
// ===========================================================================

describe("AC-STE-582.8 — the M129 target-repo suite passes with zero failures", () => {
  test(
    "bun test tests/m129-ste-495-target-repo.test.ts exits 0 with 0 fail",
    () => {
      const proc = Bun.spawnSync(
        ["bun", "test", "tests/m129-ste-495-target-repo.test.ts"],
        { cwd: PLUGIN_ROOT, stdout: "pipe", stderr: "pipe" },
      );
      const out = `${proc.stdout.toString()}\n${proc.stderr.toString()}`;
      expect(out).toMatch(/\b0 fail\b/);
      expect(proc.exitCode).toBe(0);
    },
    120_000,
  );
});

// ===========================================================================
// Stage C hardening (post-audit) — the other non-strings the arm catches. The
// parser also turns `true`/`false` into booleans and keeps a nested map's keys,
// so the refusal must not present its three named spellings as the full list.
// ===========================================================================

describe("Stage C hardening — non-strings beyond the three named spellings", () => {
  test("a bare boolean is refused, and the Context line reports the real type", () => {
    const msg = refusalFor("---\ntarget_repo: true\n---\nx");
    expect(msg).toMatch(/^Context: target_repo=<boolean>, phase=target-repo-read$/m);
  });

  test("a nested map with keys is refused, and the message admits nested maps", () => {
    const msg = refusalFor("---\ntarget_repo:\n  path: /a\n---\nx");
    expect(msg).toMatch(/nested map/i);
  });

  test("the Refusing line says what was read, not which spelling was written", () => {
    const refusing = refusalFor(BLOCK_LIST).split("\n")[0] as string;
    expect(refusing).toMatch(/non-string/i);
    expect(refusing).toMatch(/true\/false/);
  });
});
