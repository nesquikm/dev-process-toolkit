// M_8f07e0 STE-583 — a spanning declaration reader, with a front door.
//
// WHAT IS MISSING, measured on this tree at authoring time (2026-09-10, after
// STE-582 landed on the M_8f07e0 branch):
//
//   * `adapters/_shared/src/spans_repos.ts` does not exist; no plan can say a
//     milestone also lives in a second repository.
//   * `target_repo.ts` keeps `sameRepo` private (`function sameRepo`), so a
//     second consumer would have to re-derive "same tree" — a second home.
//   * `templates/spec-templates/plan.md.template` never mentions `spans_repos`.
//
// THE SHIPPED PARSER ON THIS KEY (measured, `parseFrontmatter(_, {lenient})`):
//
//     nested map (2sp / 4sp / tab / CRLF / BOM) → {"glacy-app-fe":".", …}
//     block list `  - glacy-app-fe`              → {}
//     `spans_repos: {}`                          → {}
//     bare `spans_repos:`                        → {}
//     colon-item block list `  - glacy-app-fe: .`→ {"- glacy-app-fe":".", …}
//     empty entry value `glacy-app-fe:`          → {"glacy-app-fe":"", …}
//     null entry value `glacy-app-be: null`      → {…, "glacy-app-be":null}
//     flow list `[a, b]`                         → "[a, b]"   (a STRING)
//     `~` / `""`                                 → "~" / ""   (strings)
//     `null`                                     → null
//
// TEST STRATEGY.
//
//   * Every malformed arm is asserted on its own spelling AND asserted to FAIL
//     on its sibling spellings (the cross-arm block below), so a reader that
//     collapses two arms into one message reds a named test.
//   * The four undeclared controls are four separate tests, so a run in which
//     any single one throws is a named red, not a lost aggregate.
//   * Two-root behaviour is built on the shared span fixture
//     (`tests/_span_fixture.ts`, first consumer), on REAL `mkdtempSync`
//     roots, and every root comparison goes through `realpathSync`.
//   * The front door is SPAWNED (`bun run <module>`), never imported.
//
// AC-STE-583.14 (full `bun test`, zero failures, skip count 15) is a gate
// command, not something a test file can assert about the run it is part of.

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { parseFrontmatter } from "../adapters/_shared/src/frontmatter";
import {
  ORDERED_UNREACHABLE_PIN,
  runModuleReachabilityProbe,
} from "../adapters/_shared/src/module_reachability";
import {
  SPANS_REPOS_KEY,
  type SiblingState,
  SpansReposError,
  readSpansReposDeclaration,
  resolveSpansRepos,
} from "../adapters/_shared/src/spans_repos";
import { type RepoProbe, sameRepo } from "../adapters/_shared/src/target_repo";
import { makeSpanFixture } from "./_span_fixture";

// ===========================================================================
// Paths.
// ===========================================================================

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const read = (p: string): string => readFileSync(p, "utf-8");

const MODULE = join(PLUGIN_ROOT, "adapters", "_shared", "src", "spans_repos.ts");
const TEMPLATE = join(
  PLUGIN_ROOT,
  "templates",
  "spec-templates",
  "plan.md.template",
);
const GATE_CHECK_SKILL = join(PLUGIN_ROOT, "skills", "gate-check", "SKILL.md");

// ===========================================================================
// Fixtures.
// ===========================================================================

const MILESTONE = "M_GF_78";

const NESTED_2SP = [
  "---",
  `milestone: ${MILESTONE}`,
  "spans_repos:",
  "  glacy-app-fe: .",
  "  glacy-app-be: ../glacy-app-be",
  "---",
  "x",
].join("\n");

const EXPECTED_ENTRIES = [
  { name: "glacy-app-fe", declaredPath: "." },
  { name: "glacy-app-be", declaredPath: "../glacy-app-be" },
];

const reindent = (body: string, ws: string): string =>
  body.replace(/\n {2}/g, `\n${ws}`);

const NESTED_SOURCES: ReadonlyArray<readonly [string, string]> = [
  ["4-space indentation", reindent(NESTED_2SP, "    ")],
  ["tab indentation", reindent(NESTED_2SP, "\t")],
  ["CRLF source", NESTED_2SP.replace(/\n/g, "\r\n")],
  ["BOM-prefixed source", `\uFEFF${NESTED_2SP}`],
];

const NESTED_SWAPPED = [
  "---",
  "spans_repos:",
  "  glacy-app-be: ../glacy-app-be",
  "  glacy-app-fe: .",
  "---",
  "x",
].join("\n");

const UNDECLARED_CONTROLS: ReadonlyArray<readonly [string, string]> = [
  ["no spans_repos key at all", `---\nmilestone: ${MILESTONE}\n---\nx`],
  ["spans_repos: null", "---\nspans_repos: null\n---\nx"],
  ["spans_repos: ~", "---\nspans_repos: ~\n---\nx"],
  ['spans_repos: ""', '---\nspans_repos: ""\n---\nx'],
];

// Arm 3a — flow list (the parser hands it through as a STRING).
const FLOW_LIST = "---\nspans_repos: [a, b]\n---\nx";
// Arm 3b — three spellings the parser turns into the same `{}`.
const BLOCK_LIST = "---\nspans_repos:\n  - glacy-app-fe\n  - ../glacy-app-be\n---\nx";
const EMPTY_MAP = "---\nspans_repos: {}\n---\nx";
const BARE_KEY = "---\nspans_repos:\n---\nx";
// Arm 3c — a block list whose items carry colons (keys arrive as `- name`).
const COLON_LIST =
  "---\nspans_repos:\n  - glacy-app-fe: .\n  - glacy-app-be: ../glacy-app-be\n---\nx";
// Arm 3d — an entry with an empty or null value.
const EMPTY_VALUE_FE =
  "---\nspans_repos:\n  glacy-app-fe:\n  glacy-app-be: ../glacy-app-be\n---\nx";
const EMPTY_VALUE_BE = "---\nspans_repos:\n  glacy-app-fe: .\n  glacy-app-be:\n---\nx";
const NULL_VALUE_FE =
  "---\nspans_repos:\n  glacy-app-fe: null\n  glacy-app-be: ../glacy-app-be\n---\nx";
const NULL_VALUE_BE =
  "---\nspans_repos:\n  glacy-app-fe: .\n  glacy-app-be: null\n---\nx";

const FIXTURE_REPO_NAMES = ["glacy-app-fe", "glacy-app-be"];

/** Run `fn`, returning the thrown error — or failing if nothing was thrown. */
function thrown(fn: () => unknown): Error {
  let result: unknown;
  try {
    result = fn();
  } catch (e) {
    return e as Error;
  }
  throw new Error(`expected a throw, got a return value: ${JSON.stringify(result)}`);
}

/** The refusal message a malformed spelling produces (asserts the error class). */
function refusalFor(body: string): string {
  const err = thrown(() => readSpansReposDeclaration(body));
  expect(err).toBeInstanceOf(SpansReposError);
  return err.message;
}

/** Refusing:, Remedy: and Context: each start their own, distinct line. */
function expectNfr10Shape(text: string): void {
  const lines = text.split("\n");
  const refusing = lines.findIndex((l) => l.startsWith("Refusing:"));
  const remedy = lines.findIndex((l) => l.startsWith("Remedy:"));
  const context = lines.findIndex((l) => l.startsWith("Context:"));
  expect(refusing).toBeGreaterThanOrEqual(0);
  expect(remedy).toBeGreaterThanOrEqual(0);
  expect(context).toBeGreaterThanOrEqual(0);
  expect(new Set([refusing, remedy, context]).size).toBe(3);
}

function planPath(root: string): string {
  return join(root, "specs", "plan", `${MILESTONE}.md`);
}

function byName(states: readonly SiblingState[], name: string): SiblingState {
  const hit = states.find((s) => s.name === name);
  if (!hit) {
    throw new Error(
      `no state named ${name} in ${JSON.stringify(states.map((s) => s.name))}`,
    );
  }
  return hit;
}

const real = (p: string): string => realpathSync(p);

// ===========================================================================
// Premise — the shipped parser's readings the three arms are keyed on.
// ===========================================================================

describe("premise: what the shipped parser hands the reader", () => {
  const raw = (body: string): unknown =>
    parseFrontmatter(body, { lenient: true }).spans_repos;

  test("block list, `{}` and a bare key all arrive as the same empty object", () => {
    const shapes = [BLOCK_LIST, EMPTY_MAP, BARE_KEY].map((b) => JSON.stringify(raw(b)));
    expect(shapes).toEqual(["{}", "{}", "{}"]);
  });

  test("the flow list arrives as a string; the colon list keeps its `- ` keys", () => {
    expect(raw(FLOW_LIST)).toBe("[a, b]");
    expect(Object.keys(raw(COLON_LIST) as object)).toEqual([
      "- glacy-app-fe",
      "- glacy-app-be",
    ]);
  });

  test("an empty entry value arrives as '' and a null entry value as JS null", () => {
    expect((raw(EMPTY_VALUE_FE) as Record<string, unknown>)["glacy-app-fe"]).toBe("");
    expect((raw(EMPTY_VALUE_BE) as Record<string, unknown>)["glacy-app-be"]).toBe("");
    expect((raw(NULL_VALUE_BE) as Record<string, unknown>)["glacy-app-be"]).toBeNull();
    expect((raw(NULL_VALUE_FE) as Record<string, unknown>)["glacy-app-fe"]).toBeNull();
  });
});

// ===========================================================================
// AC-STE-583.1 — a nested map reads declared, order preserved, on every source.
// ===========================================================================

describe("AC-STE-583.1 — a nested map returns ordered entries", () => {
  test("SPANS_REPOS_KEY is the literal `spans_repos`", () => {
    expect(SPANS_REPOS_KEY).toBe("spans_repos");
  });

  test("2-space nested map → { declared: true, entries: [fe ., be ../glacy-app-be] }", () => {
    expect(readSpansReposDeclaration(NESTED_2SP)).toEqual({
      declared: true,
      entries: EXPECTED_ENTRIES,
    });
  });

  for (const [label, body] of NESTED_SOURCES) {
    test(`${label} → entries deep-equal to the 2-space reading`, () => {
      expect(readSpansReposDeclaration(body)).toEqual({
        declared: true,
        entries: EXPECTED_ENTRIES,
      });
    });
  }

  test("order is preserved: the same map written be-first reads be-first", () => {
    expect(readSpansReposDeclaration(NESTED_SWAPPED)).toEqual({
      declared: true,
      entries: [EXPECTED_ENTRIES[1], EXPECTED_ENTRIES[0]],
    });
  });
});

// ===========================================================================
// AC-STE-583.2 — the four undeclared controls, one test each.
// ===========================================================================

describe("AC-STE-583.2 — every undeclared sentinel stays undeclared", () => {
  for (const [label, body] of UNDECLARED_CONTROLS) {
    test(`${label} → { declared: false, entries: null }, no throw`, () => {
      let decl: unknown;
      expect(() => {
        decl = readSpansReposDeclaration(body);
      }).not.toThrow();
      expect(decl).toEqual({ declared: false, entries: null });
    });
  }
});

// ===========================================================================
// AC-STE-583.3 — arm 3a: the flow list.
// ===========================================================================

describe("AC-STE-583.3 — a flow list is refused in the canonical shape", () => {
  test("throws a SpansReposError (name `SpansReposError`, an Error)", () => {
    const err = thrown(() => readSpansReposDeclaration(FLOW_LIST));
    expect(err).toBeInstanceOf(SpansReposError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("SpansReposError");
  });

  test("the message carries Refusing:, Remedy: and Context: at line starts", () => {
    expectNfr10Shape(refusalFor(FLOW_LIST));
  });

  test("the message contains the literal `[a, b]`", () => {
    expect(refusalFor(FLOW_LIST)).toContain("[a, b]");
  });
});

// ===========================================================================
// AC-STE-583.4 — arm 3b: block list, `{}` and bare key share one message.
// ===========================================================================

describe("AC-STE-583.4 — block list, empty map and bare key: one message", () => {
  test("a block list throws SpansReposError", () => {
    expect(() => readSpansReposDeclaration(BLOCK_LIST)).toThrow(SpansReposError);
  });

  test("`spans_repos: {}` and a bare `spans_repos:` each throw SpansReposError", () => {
    expect(() => readSpansReposDeclaration(EMPTY_MAP)).toThrow(SpansReposError);
    expect(() => readSpansReposDeclaration(BARE_KEY)).toThrow(SpansReposError);
  });

  test("the three messages are byte-identical", () => {
    const a = refusalFor(BLOCK_LIST);
    const b = refusalFor(EMPTY_MAP);
    const c = refusalFor(BARE_KEY);
    expect(a.length).toBeGreaterThan(0);
    expect(Buffer.from(b).equals(Buffer.from(a))).toBe(true);
    expect(Buffer.from(c).equals(Buffer.from(a))).toBe(true);
  });

  test("that message contains each of the words `block`, `empty` and `bare`", () => {
    const msg = refusalFor(BLOCK_LIST);
    expect(msg).toMatch(/\bblock\b/i);
    expect(msg).toMatch(/\bempty\b/i);
    expect(msg).toMatch(/\bbare\b/i);
  });

  test("that message contains no repository name from the fixture", () => {
    const msg = refusalFor(BLOCK_LIST);
    for (const name of FIXTURE_REPO_NAMES) expect(msg).not.toContain(name);
  });
});

// ===========================================================================
// AC-STE-583.5 — arm 3c: a block list whose items carry colons.
// ===========================================================================

describe("AC-STE-583.5 — a colon-item block list is refused and named", () => {
  test("throws a message containing the literal `- glacy-app-fe`", () => {
    expect(refusalFor(COLON_LIST)).toContain("- glacy-app-fe");
  });

  test("that message differs from the block-list / empty-map / bare-key message", () => {
    expect(refusalFor(COLON_LIST)).not.toBe(refusalFor(BLOCK_LIST));
  });
});

// ===========================================================================
// AC-STE-583.6 — arm 3d: an entry with an empty or null value.
// ===========================================================================

describe("AC-STE-583.6 — an entry with an empty or null value is refused by name", () => {
  test("an empty value on `glacy-app-fe:` throws a message naming `glacy-app-fe`", () => {
    expect(refusalFor(EMPTY_VALUE_FE)).toContain("glacy-app-fe");
  });

  test("a `null` value on `glacy-app-be` throws a message naming `glacy-app-be`", () => {
    expect(refusalFor(NULL_VALUE_BE)).toContain("glacy-app-be");
  });

  test("the message tracks the offender: moving the empty value to the other key names that key", () => {
    const fe = refusalFor(EMPTY_VALUE_FE);
    const be = refusalFor(EMPTY_VALUE_BE);
    expect(be).toContain("glacy-app-be");
    expect(be).not.toBe(fe);
  });

  test("the message tracks the offender: moving the null value to the other key names that key", () => {
    const be = refusalFor(NULL_VALUE_BE);
    const fe = refusalFor(NULL_VALUE_FE);
    expect(fe).toContain("glacy-app-fe");
    expect(fe).not.toBe(be);
  });
});

// ===========================================================================
// Falsifiability — each arm's distinguishing assertion FAILS on its siblings.
// ===========================================================================

describe("cross-arm falsifiability — no arm's assertion holds on a sibling arm", () => {
  const arms = (): Record<string, string> => ({
    flow: refusalFor(FLOW_LIST),
    block: refusalFor(BLOCK_LIST),
    colon: refusalFor(COLON_LIST),
    emptyValue: refusalFor(EMPTY_VALUE_FE),
  });

  test("the four arm messages (3a flow, 3b block, 3c colon, 3d empty value) are pairwise distinct", () => {
    const msgs = Object.values(arms());
    expect(new Set(msgs).size).toBe(msgs.length);
  });

  test("3a's `[a, b]` assertion fails on 3b, 3c and 3d", () => {
    const m = arms();
    for (const k of ["block", "colon", "emptyValue"]) {
      expect(m[k]).not.toContain("[a, b]");
    }
  });

  test("3b's byte-identity assertion fails on 3a, 3c, 3d and the null-value spelling", () => {
    const block = refusalFor(BLOCK_LIST);
    for (const body of [FLOW_LIST, COLON_LIST, EMPTY_VALUE_FE, NULL_VALUE_BE]) {
      expect(Buffer.from(refusalFor(body)).equals(Buffer.from(block))).toBe(false);
    }
  });

  test("3c's `- glacy-app-fe` assertion fails on 3a, 3b and 3d", () => {
    const m = arms();
    for (const k of ["flow", "block", "emptyValue"]) {
      expect(m[k]).not.toContain("- glacy-app-fe");
    }
  });

  test("3d's key-naming assertion fails on 3a and 3b", () => {
    const m = arms();
    expect(m.flow).not.toContain("glacy-app-fe");
    expect(m.block).not.toContain("glacy-app-fe");
  });
});

// ===========================================================================
// AC-STE-583.7 — two real roots: self and a sibling with bound work.
// ===========================================================================

describe("AC-STE-583.7 — resolveSpansRepos locates both roots and B's binding", () => {
  /** Plan in A declaring `.` and B (relative to A); B holds bound work. */
  function build(fx: ReturnType<typeof makeSpanFixture>): string {
    fx.planA({ "glacy-app-fe": ".", "glacy-app-be": relative(fx.a, fx.b) });
    fx.activeFr(fx.b, "STE-900", MILESTONE);
    fx.activeFr(fx.b, "STE-901", "M_OTHER"); // bound elsewhere: never counted
    fx.archivedFr(fx.b, "STE-902", MILESTONE);
    return read(planPath(fx.a));
  }

  test("one state per entry, in declaration order, declared paths verbatim", async () => {
    const fx = makeSpanFixture(MILESTONE);
    try {
      const planBody = build(fx);
      const states = await resolveSpansRepos({
        planBody,
        milestone: MILESTONE,
        invokingRepo: fx.a,
      });
      expect(states.map((s) => s.name)).toEqual(["glacy-app-fe", "glacy-app-be"]);
      expect(byName(states, "glacy-app-fe").declaredPath).toBe(".");
      expect(byName(states, "glacy-app-be").declaredPath).toBe(relative(fx.a, fx.b));
    } finally {
      fx.cleanup();
    }
  });

  test("the `.` entry resolves with self: true, rooted at A", async () => {
    const fx = makeSpanFixture(MILESTONE);
    try {
      const states = await resolveSpansRepos({
        planBody: build(fx),
        milestone: MILESTONE,
        invokingRepo: fx.a,
      });
      const fe = byName(states, "glacy-app-fe");
      expect(fe.self).toBe(true);
      expect(fe.root).not.toBeNull();
      expect(real(fe.root as string)).toBe(real(fx.a));
    } finally {
      fx.cleanup();
    }
  });

  test("B: realpath(root) === realpath(B), self: false, binding.activeFrIds.length === 1", async () => {
    const fx = makeSpanFixture(MILESTONE);
    try {
      const states = await resolveSpansRepos({
        planBody: build(fx),
        milestone: MILESTONE,
        invokingRepo: fx.a,
      });
      const be = byName(states, "glacy-app-be");
      expect(be.root).not.toBeNull();
      expect(real(be.root as string)).toBe(real(fx.b));
      expect(be.self).toBe(false);
      expect(be.binding).not.toBeNull();
      expect(be.binding?.activeFrIds.length).toBe(1);
      expect(be.binding?.activeFrIds).toEqual(["STE-900"]);
      expect(be.binding?.archivedFrIds).toEqual(["STE-902"]);
    } finally {
      fx.cleanup();
    }
  });

  test("self is decided by same-repo, not string identity: a trailing-slash invoking repo is still self", async () => {
    const fx = makeSpanFixture(MILESTONE);
    try {
      const states = await resolveSpansRepos({
        planBody: build(fx),
        milestone: MILESTONE,
        invokingRepo: `${fx.a}/`,
      });
      expect(byName(states, "glacy-app-fe").self).toBe(true);
      expect(byName(states, "glacy-app-be").self).toBe(false);
    } finally {
      fx.cleanup();
    }
  });
});

// ===========================================================================
// AC-STE-583.8 — an unlocatable sibling is a runtime fact, never a throw.
// ===========================================================================

describe("AC-STE-583.8 — a declared path that does not exist yields root/binding null", () => {
  test("the missing entry is { root: null, binding: null } and the call resolves", async () => {
    const fx = makeSpanFixture(MILESTONE);
    try {
      fx.planA({
        "glacy-app-fe": ".",
        "glacy-app-be": "../dpt-span-definitely-missing-8f07e0",
      });
      const states = await resolveSpansRepos({
        planBody: read(planPath(fx.a)),
        milestone: MILESTONE,
        invokingRepo: fx.a,
      });
      const be = byName(states, "glacy-app-be");
      expect(be.root).toBeNull();
      expect(be.binding).toBeNull();
      expect(be.self).toBe(false);
      // …and the locatable entry beside it is unaffected.
      expect(real(byName(states, "glacy-app-fe").root as string)).toBe(real(fx.a));
    } finally {
      fx.cleanup();
    }
  });

  test("an injected probe is honoured: a probe that cannot locate B yields root/binding null", async () => {
    const fx = makeSpanFixture(MILESTONE);
    try {
      fx.planA({ "glacy-app-fe": ".", "glacy-app-be": relative(fx.a, fx.b) });
      fx.activeFr(fx.b, "STE-900", MILESTONE);
      const probe: RepoProbe = {
        locate: (declared) => (declared === "." ? fx.a : null),
        hasToolkit: () => true,
      };
      const states = await resolveSpansRepos({
        planBody: read(planPath(fx.a)),
        milestone: MILESTONE,
        invokingRepo: fx.a,
        probe,
      });
      const be = byName(states, "glacy-app-be");
      expect(be.root).toBeNull();
      expect(be.binding).toBeNull();
    } finally {
      fx.cleanup();
    }
  });
});

// ===========================================================================
// AC-STE-583.9 — each fact keeps one home.
// ===========================================================================

/** Symbols imported from `spec` across every import statement in `src`. */
function importedFrom(src: string, spec: string): string[] {
  const re = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
  const names: string[] = [];
  for (const m of src.matchAll(re)) {
    if (m[2] !== spec) continue;
    for (const part of (m[1] as string).split(",")) {
      const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0];
      if (name) names.push(name);
    }
  }
  return names;
}

describe("AC-STE-583.9 — spans_repos.ts reuses the shipped homes", () => {
  test("imports parseFrontmatter from ./frontmatter", () => {
    expect(importedFrom(read(MODULE), "./frontmatter")).toContain("parseFrontmatter");
  });

  test("imports defaultRepoProbe and sameRepo from ./target_repo", () => {
    const names = importedFrom(read(MODULE), "./target_repo");
    expect(names).toContain("defaultRepoProbe");
    expect(names).toContain("sameRepo");
  });

  test("imports milestoneFrBinding from ./active_plan_ship_ready", () => {
    expect(importedFrom(read(MODULE), "./active_plan_ship_ready")).toContain(
      "milestoneFrBinding",
    );
  });

  test("contains no existsSync call", () => {
    expect(read(MODULE)).not.toMatch(/\bexistsSync\s*\(/);
  });

  test('contains no split("\\n") — no second raw-line scan', () => {
    const src = read(MODULE);
    expect(src).not.toContain('split("\\n")');
    expect(src).not.toContain("split('\\n')");
    expect(src).not.toMatch(/split\(\s*\/\\r\?\\n\//);
    expect(src).not.toMatch(/split\(\s*\/\\n\//);
  });

  test("target_repo.ts exports sameRepo, and it compares trees, not strings", () => {
    expect(typeof sameRepo).toBe("function");
    expect(sameRepo("/x/repo/", "/x/repo")).toBe(true);
    expect(sameRepo("/x/repo/./", "/x/repo")).toBe(true);
    expect(sameRepo("/x/repo", "/x/other")).toBe(false);
  });
});

// ===========================================================================
// AC-STE-583.10 — the front door runs for real.
// ===========================================================================

function runFrontDoor(args: readonly string[]) {
  return spawnSync("bun", ["run", MODULE, ...args], {
    cwd: PLUGIN_ROOT,
    encoding: "utf-8",
  });
}

const SPAWN_TIMEOUT = 30_000;

describe("AC-STE-583.10 — `bun run spans_repos.ts <plan> <milestone> <invokingRepo>`", () => {
  test(
    "a declared plan exits 0 and prints a self line and a sibling line",
    () => {
      const fx = makeSpanFixture(MILESTONE);
      try {
        fx.planA({ "glacy-app-fe": ".", "glacy-app-be": relative(fx.a, fx.b) });
        fx.activeFr(fx.b, "STE-900", MILESTONE);
        const r = runFrontDoor([planPath(fx.a), MILESTONE, fx.a]);
        expect(r.status).toBe(0);
        expect(r.stdout).toMatch(/^glacy-app-fe\s+self/m);
        expect(r.stdout).toMatch(/^glacy-app-be\s+sibling/m);
        // One line per entry.
        expect(r.stdout.split("\n").filter((l) => l.trim() !== "").length).toBe(2);
      } finally {
        fx.cleanup();
      }
    },
    SPAWN_TIMEOUT,
  );

  test(
    "the sibling line carries its declared path, root=<B> and active=1 archived=1",
    () => {
      const fx = makeSpanFixture(MILESTONE);
      try {
        const bRel = relative(fx.a, fx.b);
        fx.planA({ "glacy-app-fe": ".", "glacy-app-be": bRel });
        fx.activeFr(fx.b, "STE-900", MILESTONE);
        fx.archivedFr(fx.b, "STE-902", MILESTONE);
        const r = runFrontDoor([planPath(fx.a), MILESTONE, fx.a]);
        expect(r.status).toBe(0);
        const m = r.stdout.match(
          /^glacy-app-be\s+sibling\s+(\S+)\s+root=(\S+)\s+active=(\d+)\s+archived=(\d+)\s*$/m,
        );
        expect(m).not.toBeNull();
        const [, declared, root, active, archived] = m as RegExpMatchArray;
        expect(declared).toBe(bRel);
        expect(real(root as string)).toBe(real(fx.b));
        expect(active).toBe("1");
        expect(archived).toBe("1");
      } finally {
        fx.cleanup();
      }
    },
    SPAWN_TIMEOUT,
  );

  test(
    "the self line carries the declared `.` and root=<A>",
    () => {
      const fx = makeSpanFixture(MILESTONE);
      try {
        fx.planA({ "glacy-app-fe": ".", "glacy-app-be": relative(fx.a, fx.b) });
        const r = runFrontDoor([planPath(fx.a), MILESTONE, fx.a]);
        expect(r.status).toBe(0);
        const m = r.stdout.match(/^glacy-app-fe\s+self\s+\.\s+root=(\S+)/m);
        expect(m).not.toBeNull();
        expect(real((m as RegExpMatchArray)[1] as string)).toBe(real(fx.a));
      } finally {
        fx.cleanup();
      }
    },
    SPAWN_TIMEOUT,
  );

  test(
    "an unlocatable sibling prints root=UNLOCATABLE and still exits 0",
    () => {
      const fx = makeSpanFixture(MILESTONE);
      try {
        fx.planA({
          "glacy-app-fe": ".",
          "glacy-app-be": "../dpt-span-definitely-missing-8f07e0",
        });
        const r = runFrontDoor([planPath(fx.a), MILESTONE, fx.a]);
        expect(r.status).toBe(0);
        expect(r.stdout).toMatch(/^glacy-app-be\s+sibling\s+\S+\s+root=UNLOCATABLE\b/m);
      } finally {
        fx.cleanup();
      }
    },
    SPAWN_TIMEOUT,
  );

  test(
    "an undeclared plan exits 0 with empty stdout",
    () => {
      const fx = makeSpanFixture(MILESTONE);
      try {
        fx.planA({}); // empty record → no spans_repos: key at all
        expect(read(planPath(fx.a))).not.toContain("spans_repos");
        const r = runFrontDoor([planPath(fx.a), MILESTONE, fx.a]);
        expect(r.status).toBe(0);
        expect(r.stdout).toBe("");
      } finally {
        fx.cleanup();
      }
    },
    SPAWN_TIMEOUT,
  );
});

// ===========================================================================
// AC-STE-583.11 — the front door refuses loudly, on stderr only.
// ===========================================================================

describe("AC-STE-583.11 — no arguments or a malformed plan: non-zero, empty stdout, NFR-10 stderr", () => {
  const expectRefusal = (r: ReturnType<typeof runFrontDoor>): void => {
    expect(typeof r.status).toBe("number");
    expect(r.status).not.toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/^Refusing:/m);
    expect(r.stderr).toMatch(/^Remedy:/m);
    expect(r.stderr).toMatch(/^Context:/m);
  };

  test(
    "no arguments",
    () => {
      expectRefusal(runFrontDoor([]));
    },
    SPAWN_TIMEOUT,
  );

  const malformed: ReadonlyArray<readonly [string, string]> = [
    ["a block list", BLOCK_LIST],
    ["a flow list", FLOW_LIST],
  ];
  for (const [label, body] of malformed) {
    test(
      `a plan declaring ${label}`,
      () => {
        const fx = makeSpanFixture(MILESTONE);
        try {
          writeFileSync(planPath(fx.a), body.replace("---\n", `---\nmilestone: ${MILESTONE}\n`));
          expectRefusal(runFrontDoor([planPath(fx.a), MILESTONE, fx.a]));
        } finally {
          fx.cleanup();
        }
      },
      SPAWN_TIMEOUT,
    );
  }
});

// ===========================================================================
// AC-STE-583.12 — documented in the plan template, never scaffolded.
// ===========================================================================

describe("AC-STE-583.12 — plan.md.template documents spans_repos, never scaffolds it", () => {
  const template = (): string => read(TEMPLATE);

  test("an HTML comment in the template names spans_repos", () => {
    const comments = [...template().matchAll(/<!--([\s\S]*?)-->/g)].map(
      (m) => m[1] as string,
    );
    expect(comments.some((c) => c.includes("spans_repos"))).toBe(true);
  });

  test("no line of the template's frontmatter block begins with `spans_repos:`", () => {
    const lines = template().split("\n");
    expect(lines[0]).toBe("---");
    const close = lines.indexOf("---", 1);
    expect(close).toBeGreaterThan(0);
    const fm = lines.slice(1, close);
    expect(fm.length).toBeGreaterThan(0);
    expect(fm.some((l) => l.startsWith("spans_repos:"))).toBe(false);
  });

  test("the reader sees the template as undeclared", () => {
    expect(readSpansReposDeclaration(template())).toEqual({
      declared: false,
      entries: null,
    });
  });
});

// ===========================================================================
// AC-STE-583.13 — no new probe; the reachability ratchet holds.
// ===========================================================================

describe("AC-STE-583.13 — no new probe, and the reachability ratchet holds", () => {
  test("skills/gate-check/SKILL.md still numbers 85 probes", () => {
    const hits = read(GATE_CHECK_SKILL).match(/^[0-9]+\. \*\*/gm) ?? [];
    expect(hits.length).toBe(85);
  });

  test("spans_repos.ts carries an `import.meta.main` front door", () => {
    const count = read(MODULE)
      .split("\n")
      .filter((l) => l.includes("import.meta.main")).length;
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test(
    "runModuleReachabilityProbe reports orderedUnreachable === ORDERED_UNREACHABLE_PIN, ok: true",
    async () => {
      const report = await runModuleReachabilityProbe(REPO_ROOT);
      expect(report.orderedUnreachable).toBe(ORDERED_UNREACHABLE_PIN);
      expect(report.ok).toBe(true);
    },
    60_000,
  );
});

// ===========================================================================
// Stage C hardening (post-refactor) — the catch-all arm. The parser coerces a
// bare `true` itself, so a whole-value scalar is reachable from ordinary YAML
// and must refuse in the canonical shape, never fall through as undeclared.
// ===========================================================================

describe("Stage C hardening — a whole-value scalar is refused, never read as undeclared", () => {
  for (const [label, body] of [
    ["boolean", "---\nspans_repos: true\n---\nx"],
    ["number", "---\nspans_repos: 5\n---\nx"],
  ] as const) {
    test(`${label}: SpansReposError in the three-line shape, naming the parsed type`, () => {
      const raw = parseFrontmatter(body, { lenient: true }).spans_repos;
      let err: unknown;
      try {
        readSpansReposDeclaration(body);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(SpansReposError);
      const msg = (err as Error).message;
      expect(msg).toMatch(/^Refusing:/m);
      expect(msg).toMatch(/^Remedy:/m);
      expect(msg).toMatch(/^Context:/m);
      // Named from what the parser actually produced: a number the parser does
      // not coerce arrives as a string and is refused by the flow-list arm.
      expect(msg).toContain(`spans_repos=${typeof raw}`);
    });
  }
});

// ===========================================================================
// Stage C hardening (post-audit) — entry-level sentinels and a bare `-` key.
// `~` and "null" mean "undeclared" at the top level, so as an ENTRY value they
// are not a path: `~` would expand to the home directory and resolve a real,
// wrong sibling. A bare `-` key is a list item, not a repo named "-".
// ===========================================================================

function refusalOf(body: string): string {
  let err: unknown;
  try {
    readSpansReposDeclaration(body);
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(SpansReposError);
  return (err as Error).message;
}

describe("Stage C hardening — entry sentinels are refused, never read as paths", () => {
  for (const sentinel of ["~", "null"]) {
    test(`an entry whose value is ${sentinel} is refused, naming its key`, () => {
      const msg = refusalOf(
        `---\nspans_repos:\n  glacy-app-fe: .\n  glacy-app-be: ${sentinel}\n---\nx`,
      );
      expect(msg).toContain("glacy-app-be");
      expect(msg).toMatch(/^Refusing:/m);
      expect(msg).toMatch(/^Context:/m);
    });
  }

  test("a bare `-` key is refused as a list item, not accepted as a repo named -", () => {
    const msg = refusalOf("---\nspans_repos:\n  -: .\n---\nx");
    expect(msg).toMatch(/list item/);
  });

  test("control: a real path beside them still reads declared", () => {
    const decl = readSpansReposDeclaration(
      "---\nspans_repos:\n  glacy-app-fe: .\n  glacy-app-be: ../glacy-app-be\n---\nx",
    );
    expect(decl.declared).toBe(true);
  });
});
