// M_79b1f6 / STE-588 — the ship-coherence gate grades a milestone's sibling half.
//
// THE DEFECT, stated once: probe #63 graded a shipped (archived, stamped) plan
// against THIS repository alone. A plan declaring `spans_repos:` is half of a
// two-repository milestone, and a release covering only the local half read as
// complete. The sibling leg reads the sibling named in the declaration and
// reports one new violation kind, `sibling_unshipped`, plus one aggregated
// notes row, `siblings awaiting release: …`.
//
// THE CONTRACT these tests build to:
//
//   * The leg runs only on an ARCHIVED plan whose `shipped_in:` stamp resolves
//     to a CHANGELOG `## [X.Y.Z]` heading and which declares `spans_repos:`.
//     So every fixture below writes an archived stamped plan plus a matching
//     CHANGELOG heading into root A. No README is written, which keeps the
//     release-surface agreement check vacuous and out of every count here.
//   * Three violation triggers, one distinct reason phrase each:
//       no plan        — the located sibling has no plan for the milestone at
//                        either `specs/plan/<M>.md` or `specs/plan/archive/<M>.md`
//       disagreement   — the sibling plan's own `spans_repos:` is undeclared, or
//                        locates no entry naming this repository
//                        ("does not name this repo back")
//       malformed      — the LOCAL plan's `spans_repos:` refuses to parse
//                        ("malformed spans_repos")
//   * Two note states, and a third reached only through `ship_partial: true`:
//       unshipped      — the sibling plan agrees, but its stamp is absent,
//                        `null`, empty or malformed
//       unlocatable    — the declared path locates nothing on this machine
//       no plan        — the no-plan trigger, downgraded by `ship_partial: true`
//     All of them aggregate into ONE notes row for the whole report:
//       `siblings awaiting release: <M> → <name> (<state>)`, joined by `, `.
//
// Every tree is a pair of REAL temp roots from `tests/_span_fixture.ts`, torn
// down in a `finally`. The fixture writes LIVE plans only, so the archived
// copies are written here, into its roots, with the writer below.
//
// Filter by AC with `bun test -t "AC-STE-588.N"`.

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";

import {
  ORDERED_UNREACHABLE_PIN,
  runModuleReachabilityProbe,
} from "../adapters/_shared/src/module_reachability";
import {
  runPlanShipCoherenceProbe,
  type PlanShipCoherenceReport,
  type PlanShipCoherenceViolation,
} from "../adapters/_shared/src/plan_ship_coherence";
import { classifyResume } from "../adapters/_shared/src/resume_classifier";
import { SpansReposError, readSpansReposDeclaration } from "../adapters/_shared/src/spans_repos";
import { gradedViolations } from "./_plan_ship_grading";
import { type SpanFixture, makeSpanFixture } from "./_span_fixture";

// ===========================================================================
// Paths.
// ===========================================================================

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const SHARED_SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src");
const PROBE_MODULE = join(SHARED_SRC, "plan_ship_coherence.ts");
const SIBLING_MODULE = join(SHARED_SRC, "sibling_release.ts");
const SPANS_MODULE = join(SHARED_SRC, "spans_repos.ts");
const GATE_SKILL = join(PLUGIN_ROOT, "skills", "gate-check", "SKILL.md");
const DOGFOOD_SCOPE_SUITE = join(PLUGIN_ROOT, "tests", "m_a8e09a-ste-574-dogfood-scope.test.ts");

const read = (p: string): string => readFileSync(p, "utf-8").replace(/\r\n/g, "\n");

// ===========================================================================
// Vocabulary.
// ===========================================================================

const KIND = "sibling_unshipped";
const NOTE_PREFIX = "siblings awaiting release: ";
const NOTE_RE = /^siblings awaiting release: /;

/** The three reason phrases, one per trigger. */
const NO_PLAN = "no plan";
const DISAGREE = "does not name this repo back";
const MALFORMED = "malformed spans_repos";

const MILESTONE = "M_GF_79";
const SECOND = "M_GF_80";
const A_NAME = "glacy-app-fe";
const B_NAME = "glacy-app-be";
const C_NAME = "glacy-app-api";

/** The release every local stamp resolves to, and the CHANGELOG that carries it. */
const LOCAL_STAMP = "v2.83.0";
const CHANGELOG = [
  "# Changelog",
  "",
  '## [2.83.0] — 2026-09-10 — "Fixture"',
  "",
  "- something",
  "",
].join("\n");

type Where = "live" | "archive";

/**
 * Write a plan for `token` under `root`. Every frontmatter key is explicit:
 * `shipped_in: undefined` OMITS the key (the absent state), `null` writes the
 * template sentinel, and any string is written verbatim after the colon (so
 * `'""'` is the quoted empty value and `""` is the bare key). An empty `spans`
 * record omits `spans_repos:`; `spansRaw` writes the key's line verbatim
 * instead, for malformed spellings.
 */
function writePlan(
  root: string,
  where: Where,
  token: string,
  opts: {
    spans?: Record<string, string>;
    spansRaw?: string;
    shippedIn?: string | null | undefined;
    extra?: Record<string, string>;
  } = {},
): string {
  const dir =
    where === "archive" ? join(root, "specs", "plan", "archive") : join(root, "specs", "plan");
  mkdirSync(dir, { recursive: true });
  const lines = [
    "---",
    `milestone: ${token}`,
    `status: ${where === "archive" ? "archived" : "active"}`,
    `archived_at: ${where === "archive" ? "2026-09-10T00:00:00Z" : "null"}`,
  ];
  if ("shippedIn" in opts && opts.shippedIn !== undefined) {
    lines.push(opts.shippedIn === null ? "shipped_in: null" : `shipped_in: ${opts.shippedIn}`.trimEnd());
  }
  if (opts.spansRaw !== undefined) {
    lines.push(opts.spansRaw);
  } else {
    const entries = Object.entries(opts.spans ?? {});
    if (entries.length > 0) {
      lines.push("spans_repos:");
      for (const [name, path] of entries) lines.push(`  ${name}: ${path}`);
    }
  }
  for (const [key, value] of Object.entries(opts.extra ?? {})) lines.push(`${key}: ${value}`);
  lines.push("---", "", `# ${token}`, "");
  const file = join(dir, `${token}.md`);
  writeFileSync(file, lines.join("\n"));
  return file;
}

/** Root A's CHANGELOG, carrying the heading every local stamp resolves to. */
const writeChangelog = (fx: SpanFixture): void =>
  writeFileSync(join(fx.a, "CHANGELOG.md"), CHANGELOG);

/** A's map: itself at `.`, B at its real relative path. */
const spansAtoB = (fx: SpanFixture): Record<string, string> => ({
  [A_NAME]: ".",
  [B_NAME]: relative(fx.a, fx.b),
});

/** B's map naming A back. */
const spansBtoA = (fx: SpanFixture): Record<string, string> => ({
  [A_NAME]: relative(fx.b, fx.a),
  [B_NAME]: ".",
});

/**
 * A path that locates nothing on this machine. Derived from root B's own
 * relative path plus a digit, so no word is hand-named into any path.
 */
const nowhere = (fx: SpanFixture, n: number): string => `${relative(fx.a, fx.b)}${n}`;

/** The local archived stamped spanning plan every trigger fixture starts from. */
function localStamped(
  fx: SpanFixture,
  token: string = MILESTONE,
  opts: { spans?: Record<string, string>; spansRaw?: string; extra?: Record<string, string> } = {},
): string {
  writeChangelog(fx);
  return writePlan(fx.a, "archive", token, {
    spans: opts.spans ?? spansAtoB(fx),
    spansRaw: opts.spansRaw,
    shippedIn: LOCAL_STAMP,
    extra: opts.extra,
  });
}

/** Build a fixture, run `body`, always clean up. */
async function withFixture<T>(body: (fx: SpanFixture) => Promise<T>): Promise<T> {
  const fx = makeSpanFixture(MILESTONE);
  try {
    return await body(fx);
  } finally {
    fx.cleanup();
  }
}

const siblingRows = (r: PlanShipCoherenceReport): PlanShipCoherenceViolation[] =>
  r.violations.filter((v) => v.kind === KIND);

const siblingNotes = (r: PlanShipCoherenceReport): string[] =>
  r.notes.filter((n) => NOTE_RE.test(n));

/** The `, `-joined entries of the one sibling notes row, as a sorted list. */
function noteEntries(r: PlanShipCoherenceReport): string[] {
  const rows = siblingNotes(r);
  expect(rows.length, `expected ONE sibling notes row, got:\n${r.notes.join("\n") || "(none)"}`).toBe(1);
  return rows[0]!.slice(NOTE_PREFIX.length).split(", ").sort();
}

const describeRows = (rows: readonly PlanShipCoherenceViolation[]): string =>
  rows.map((r) => `  - [${String(r.kind)}] ${r.reason}`).join("\n") || "  (none)";

const describeReport = (r: PlanShipCoherenceReport): string =>
  `violations:\n${describeRows(r.violations)}\nnotes:\n${r.notes.map((n) => `  - ${n}`).join("\n") || "  (none)"}`;

// ---------------------------------------------------------------------------
// The trigger fixtures, named once — AC.4, AC.5, AC.6, AC.9, AC.10 and AC.13
// all read the same trees.
// ---------------------------------------------------------------------------

/** AC.4: B is located and holds no plan for the milestone at either path. */
function buildNoPlan(fx: SpanFixture, extra?: Record<string, string>): void {
  localStamped(fx, MILESTONE, { extra });
}

/** AC.4's healthy twin: B holds an agreeing, stamped, archived plan. */
function buildHealthyTwin(fx: SpanFixture): void {
  localStamped(fx);
  writePlan(fx.b, "archive", MILESTONE, { spans: spansBtoA(fx), shippedIn: "v1.4.0" });
}

/** AC.5 (a): B's plan exists but declares no `spans_repos:` at all. */
function buildDisagreeUndeclared(fx: SpanFixture): void {
  localStamped(fx);
  writePlan(fx.b, "archive", MILESTONE, { spans: {}, shippedIn: null });
}

/** AC.5 (b): B's plan declares a map whose only non-self entry locates a directory that is not A. */
function buildDisagreeElsewhere(fx: SpanFixture): void {
  localStamped(fx);
  writePlan(fx.b, "archive", MILESTONE, {
    spans: { [A_NAME]: relative(fx.b, join(fx.a, "specs")), [B_NAME]: "." },
    shippedIn: null,
  });
}

/** AC.5 (c): B's plan names only itself. */
function buildDisagreeSelfOnly(fx: SpanFixture): void {
  localStamped(fx);
  writePlan(fx.b, "archive", MILESTONE, { spans: { [B_NAME]: "." }, shippedIn: null });
}

/** A flow list: the shared parser hands it back as a STRING, which refuses. */
const MALFORMED_SPANS_LINE = `spans_repos: [${A_NAME}, ${B_NAME}]`;

/** AC.6: the LOCAL plan's declaration is malformed. */
function buildMalformed(fx: SpanFixture, token: string = MILESTONE): string {
  return localStamped(fx, token, { spansRaw: MALFORMED_SPANS_LINE });
}

// ===========================================================================
// AC-STE-588.1 — the kind, the factory, and the one reader of the map
// ===========================================================================

/** Strip `//` line comments and block comments, keeping string contents. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
}

describe("AC-STE-588.1 — sibling_unshipped is the fourth kind, pushed only through makeViolation", () => {
  test("PlanShipCoherenceViolationKind declares exactly four members, sibling_unshipped fourth", () => {
    const src = read(PROBE_MODULE);
    const m = /export type PlanShipCoherenceViolationKind\s*=\s*((?:\s*\|?\s*"[a-z_]+")+)\s*;/.exec(src);
    expect(m, "no `export type PlanShipCoherenceViolationKind = …;` string-literal union").not.toBeNull();
    const members = [...m![1]!.matchAll(/"([a-z_]+)"/g)].map((x) => x[1]!);
    expect(members).toEqual(["unshipped_debt", "corrupt_stamp", "surface_disagreement", KIND]);
  });

  test("every occurrence of the literal outside the union is makeViolation's first argument", () => {
    const code = stripComments(read(PROBE_MODULE));
    const all = [...code.matchAll(/"sibling_unshipped"/g)].length;
    const viaFactory = [...code.matchAll(/makeViolation\(\s*"sibling_unshipped"/g)].length;
    // Non-vacuity: at least one push site exists.
    expect(viaFactory, "no `makeViolation(\"sibling_unshipped\", …)` push site").toBeGreaterThan(0);
    // One occurrence is the union member itself; every other one is a factory call.
    expect(all, "the literal appears outside the union and outside makeViolation").toBe(viaFactory + 1);
    expect(code, "a raw `kind: \"sibling_unshipped\"` object literal bypasses the factory").not.toMatch(
      /kind:\s*"sibling_unshipped"/,
    );
  });

  test("the module imports resolveSpansRepos from ./spans_repos and the reader from ./sibling_release", () => {
    const src = read(PROBE_MODULE);
    expect(src).toMatch(/import\s*\{[^}]*\bresolveSpansRepos\b[^}]*\}\s*from\s*"\.\/spans_repos"/);
    expect(src).toMatch(/from\s*"\.\/sibling_release"/);
  });

  test("the module holds no private parse of the spans_repos: map", () => {
    // Comments may NAME the key; code may not read it. The import specifier
    // `"./spans_repos"` is the one sanctioned spelling in code.
    const code = stripComments(read(PROBE_MODULE)).replace(/"\.\/spans_repos"/g, "");
    expect(code, "plan_ship_coherence.ts reads the spans_repos key itself").not.toMatch(/spans_repos/);
    expect(code, "plan_ship_coherence.ts reads the spans_repos key by constant").not.toContain(
      "SPANS_REPOS_KEY",
    );
    expect(code, "plan_ship_coherence.ts parses frontmatter maps itself").not.toMatch(
      /\bparseFrontmatter\s*\(/,
    );
  });

  test("the sibling-plan reader lives in sibling_release.ts and reads through the shared parser", () => {
    expect(existsSync(SIBLING_MODULE), "adapters/_shared/src/sibling_release.ts is missing").toBe(true);
    const src = read(SIBLING_MODULE);
    expect(src).toMatch(/import\s*\{[^}]*\bparseFrontmatter\b[^}]*\}\s*from\s*"\.\/frontmatter"/);
    // Both sibling plan paths are the reader's to union.
    expect(src).toContain('"archive"');
  });

  test("every sibling row carries makeViolation's shape: note, NFR-10 message, probe context", async () => {
    await withFixture(async (fx) => {
      buildNoPlan(fx);
      const report = await runPlanShipCoherenceProbe(fx.a);
      const rows = siblingRows(report);
      expect(rows.length, describeReport(report)).toBe(1);
      const row = rows[0]!;
      const rel = join("specs", "plan", "archive", `${MILESTONE}.md`);
      expect(row.note).toBe(`${rel}:${row.line} — ${row.reason}`);
      const lines = row.message.split("\n");
      expect(lines[0]).toBe(`plan_ship_coherence: ${row.reason}`);
      expect(row.message).toMatch(/^Remedy: /m);
      expect(row.message).toMatch(/^Context: file=specs\/plan\/archive\/M_GF_79\.md, .*probe=plan_ship_coherence$/m);
    });
  });

  test("the new reader module is reachable: live reachability equals the shipped pin", async () => {
    const report = await runModuleReachabilityProbe(REPO_ROOT);
    expect(report.orderedUnreachable).toBe(ORDERED_UNREACHABLE_PIN);
    expect(report.ok).toBe(true);
  });
});

// ===========================================================================
// AC-STE-588.2 — vacuity, and the transient set stays narrow
// ===========================================================================

describe("AC-STE-588.2 — an archived stamped plan with no spans_repos is untouched", () => {
  test("zero sibling rows and no sibling note on an undeclared plan", async () => {
    await withFixture(async (fx) => {
      writeChangelog(fx);
      writePlan(fx.a, "archive", MILESTONE, { spans: {}, shippedIn: LOCAL_STAMP });
      // Root B holds an unshipped plan for the SAME milestone: it must not be
      // reached for, because nothing on the local plan names it.
      writePlan(fx.b, "live", MILESTONE, { spans: spansBtoA(fx), shippedIn: null });
      const report = await runPlanShipCoherenceProbe(fx.a);
      expect(report.violations, describeReport(report)).toEqual([]);
      expect(siblingNotes(report)).toEqual([]);
    });
  });

  test("the live repo root declares no span and yields no sibling row and no sibling note", async () => {
    const report = await runPlanShipCoherenceProbe(REPO_ROOT);
    expect(siblingRows(report), describeRows(report.violations)).toEqual([]);
    expect(siblingNotes(report)).toEqual([]);
  });

  test("a sibling_unshipped row SURVIVES the dogfood's grading predicate (the transient set is not widened)", async () => {
    await withFixture(async (fx) => {
      buildNoPlan(fx);
      const report = await runPlanShipCoherenceProbe(fx.a);
      const rows = siblingRows(report);
      expect(rows.length, describeReport(report)).toBe(1);
      expect(gradedViolations(report.violations)).toContain(rows[0]!);
    });
  });

  test("tests/_plan_ship_grading.ts is unchanged against main", () => {
    const proc = spawnSync("git", ["diff", "main...HEAD", "--", "tests/_plan_ship_grading.ts"], {
      cwd: PLUGIN_ROOT,
      encoding: "utf-8",
    });
    expect(proc.status, proc.stderr).toBe(0);
    expect(proc.stdout, "the transient set was widened on this branch").toBe("");
  });

  test(
    "the m141 surface-agreement suite passes over the live repo root",
    () => {
      const proc = spawnSync("bun", ["test", "tests/m141-ste-546-surface-agreement.test.ts"], {
        cwd: PLUGIN_ROOT,
        encoding: "utf-8",
      });
      const out = `${proc.stdout}${proc.stderr}`;
      expect(proc.status, out.slice(-3000)).toBe(0);
      // Non-vacuity: a run that collected nothing exits 0 too.
      expect(out).toMatch(/\b[1-9]\d* pass\b/);
    },
    120_000,
  );
});

// ===========================================================================
// AC-STE-588.3 — the corrupt-stamp branch ends in `continue`
// ===========================================================================

describe("AC-STE-588.3 — a corrupt stamp is the only row, whatever the sibling says", () => {
  test("the missing-heading branch in the source ends in continue", () => {
    const src = read(PROBE_MODULE);
    const m = /if \(!changelogVersions\.has\([^)]*\)\) \{([\s\S]*?)\n {4}\}/.exec(src);
    expect(m, "no `if (!changelogVersions.has(…)) {` branch at loop depth").not.toBeNull();
    expect(
      m![1]!.trimEnd(),
      "the missing-heading branch falls through into the sibling leg",
    ).toMatch(/continue;$/);
  });

  test("a stamp with no CHANGELOG heading and a defective sibling yields one corrupt_stamp row", async () => {
    await withFixture(async (fx) => {
      writeChangelog(fx);
      // v9.9.9 has no heading; B is located and holds no plan — the no-plan trigger.
      writePlan(fx.a, "archive", MILESTONE, { spans: spansAtoB(fx), shippedIn: "v9.9.9" });
      const report = await runPlanShipCoherenceProbe(fx.a);
      expect(report.violations.length, describeReport(report)).toBe(1);
      expect(report.violations[0]!.kind).toBe("corrupt_stamp");
      expect(siblingNotes(report)).toEqual([]);
    });
  });

  test("a malformed stamp and a defective sibling yields one corrupt_stamp row", async () => {
    await withFixture(async (fx) => {
      writeChangelog(fx);
      writePlan(fx.a, "archive", MILESTONE, { spans: spansAtoB(fx), shippedIn: "2.83.0" });
      const report = await runPlanShipCoherenceProbe(fx.a);
      expect(report.violations.length, describeReport(report)).toBe(1);
      expect(report.violations[0]!.kind).toBe("corrupt_stamp");
    });
  });
});

// ===========================================================================
// AC-STE-588.4 — the no-plan trigger
// ===========================================================================

describe("AC-STE-588.4 — a located sibling with no plan for the milestone", () => {
  test("yields exactly one sibling_unshipped row whose reason names the missing plan", async () => {
    await withFixture(async (fx) => {
      buildNoPlan(fx);
      // The fixture really holds no plan for the milestone at either path.
      expect(existsSync(join(fx.b, "specs", "plan", `${MILESTONE}.md`))).toBe(false);
      expect(existsSync(join(fx.b, "specs", "plan", "archive", `${MILESTONE}.md`))).toBe(false);
      const report = await runPlanShipCoherenceProbe(fx.a);
      expect(report.violations.length, describeReport(report)).toBe(1);
      const row = report.violations[0]!;
      expect(row.kind).toBe(KIND);
      expect(row.reason).toContain(NO_PLAN);
      expect(row.reason).toContain(MILESTONE);
      expect(row.reason).toContain(B_NAME);
    });
  });

  test("with ship_partial: true on the local plan: zero rows, and the sibling is noted as (no plan)", async () => {
    await withFixture(async (fx) => {
      buildNoPlan(fx, { ship_partial: "true" });
      const report = await runPlanShipCoherenceProbe(fx.a);
      expect(report.violations, describeReport(report)).toEqual([]);
      expect(siblingNotes(report)).toEqual([`${NOTE_PREFIX}${MILESTONE} → ${B_NAME} (no plan)`]);
    });
  });

  test("ship_partial downgrades ONLY the no-plan trigger: a disagreement still fails", async () => {
    await withFixture(async (fx) => {
      localStamped(fx, MILESTONE, { extra: { ship_partial: "true" } });
      writePlan(fx.b, "archive", MILESTONE, { spans: {}, shippedIn: null });
      const report = await runPlanShipCoherenceProbe(fx.a);
      const rows = siblingRows(report);
      expect(rows.length, describeReport(report)).toBe(1);
      expect(rows[0]!.reason).toContain(DISAGREE);
    });
  });

  test("ship_partial downgrades ONLY the no-plan trigger: a malformed declaration still fails", async () => {
    await withFixture(async (fx) => {
      localStamped(fx, MILESTONE, { spansRaw: MALFORMED_SPANS_LINE, extra: { ship_partial: "true" } });
      const report = await runPlanShipCoherenceProbe(fx.a);
      const rows = siblingRows(report);
      expect(rows.length, describeReport(report)).toBe(1);
      expect(rows[0]!.reason).toContain(MALFORMED);
    });
  });
});

// ===========================================================================
// AC-STE-588.5 — the disagreement trigger
// ===========================================================================

describe("AC-STE-588.5 — a sibling plan that does not name this repo back", () => {
  const arms: Array<[string, (fx: SpanFixture) => void]> = [
    ["its spans_repos: is undeclared", buildDisagreeUndeclared],
    ["its only other entry locates a directory that is not this repo", buildDisagreeElsewhere],
    ["it names only itself", buildDisagreeSelfOnly],
  ];
  for (const [label, build] of arms) {
    test(`yields exactly one sibling_unshipped row naming the disagreement when ${label}`, async () => {
      await withFixture(async (fx) => {
        build(fx);
        const report = await runPlanShipCoherenceProbe(fx.a);
        expect(report.violations.length, describeReport(report)).toBe(1);
        const row = report.violations[0]!;
        expect(row.kind).toBe(KIND);
        expect(row.reason).toContain(DISAGREE);
        expect(row.reason).toContain(B_NAME);
      });
    });
  }

  test("the control: the same sibling plan naming A back yields no row", async () => {
    await withFixture(async (fx) => {
      localStamped(fx);
      writePlan(fx.b, "archive", MILESTONE, { spans: spansBtoA(fx), shippedIn: null });
      const report = await runPlanShipCoherenceProbe(fx.a);
      expect(report.violations, describeReport(report)).toEqual([]);
      // … and it is noted as unshipped, so the control is not a silent tree.
      expect(siblingNotes(report)).toEqual([`${NOTE_PREFIX}${MILESTONE} → ${B_NAME} (unshipped)`]);
    });
  });
});

// ===========================================================================
// AC-STE-588.6 — per-plan containment of a malformed declaration
// ===========================================================================

describe("AC-STE-588.6 — one malformed spans_repos: is one row, never a throw", () => {
  /** A healthy spanning plan for SECOND whose sibling is agreeing but unshipped. */
  function healthySecond(fx: SpanFixture): void {
    localStamped(fx, SECOND);
    writePlan(fx.b, "live", SECOND, { spans: spansBtoA(fx), shippedIn: null });
  }

  test("the malformed plan yields one sibling_unshipped row carrying the refusal text", async () => {
    await withFixture(async (fx) => {
      const file = buildMalformed(fx);
      let refusal = "";
      try {
        readSpansReposDeclaration(read(file));
      } catch (e) {
        expect(e).toBeInstanceOf(SpansReposError);
        refusal = (e as Error).message;
      }
      expect(refusal, "the fixture's declaration does not actually refuse").not.toBe("");
      const refusing = refusal.split("\n")[0]!.replace(/^Refusing: /, "");

      const report = await runPlanShipCoherenceProbe(fx.a);
      const rows = siblingRows(report);
      expect(rows.length, describeReport(report)).toBe(1);
      expect(basename(rows[0]!.file, ".md")).toBe(MILESTONE);
      expect(rows[0]!.reason).toContain(MALFORMED);
      expect(rows[0]!.message, "the row drops the parser's refusal").toContain(refusing);
    });
  });

  test("the probe does not throw, and a healthy second plan is graded exactly as it is alone", async () => {
    const normalize = (r: PlanShipCoherenceReport, token: string) => ({
      violations: r.violations
        .filter((v) => basename(v.file, ".md") === token)
        .map(({ kind, line, reason, note, message }) => ({ kind, line, reason, note, message })),
      notes: r.notes,
    });

    const alone = await withFixture(async (fx) => {
      healthySecond(fx);
      return normalize(await runPlanShipCoherenceProbe(fx.a), SECOND);
    });
    const together = await withFixture(async (fx) => {
      buildMalformed(fx);
      healthySecond(fx);
      const pending = runPlanShipCoherenceProbe(fx.a);
      await expect(pending).resolves.toBeDefined();
      const report = await pending;
      // The malformed plan's row is present, so "together" really holds both.
      expect(siblingRows(report).filter((v) => basename(v.file, ".md") === MILESTONE).length).toBe(1);
      return normalize(report, SECOND);
    });

    // Non-vacuity: the healthy plan is graded to SOMETHING — its sibling note.
    expect(alone.notes).toEqual([`${NOTE_PREFIX}${SECOND} → ${B_NAME} (unshipped)`]);
    expect(together).toEqual(alone);
  });
});

// ===========================================================================
// Hardening (/implement Phase 3) — every sibling_unshipped row keeps the
// canonical NFR-10 message shape: one Remedy: line, one Context: line.
// ===========================================================================

describe("STE-588 hardening — a sibling_unshipped row keeps the NFR-10 shape", () => {
  /** How many lines of `message` open with `<label>:`. */
  const labelled = (message: string, label: string): number =>
    message.split("\n").filter((line) => line.startsWith(`${label}:`)).length;

  test("the control: a no-plan row carries exactly one Remedy: and one Context: line", async () => {
    await withFixture(async (fx) => {
      buildNoPlan(fx);
      const rows = siblingRows(await runPlanShipCoherenceProbe(fx.a));
      expect(rows.length).toBe(1);
      const { message } = rows[0]!;
      expect(labelled(message, "Remedy"), message).toBe(1);
      expect(labelled(message, "Context"), message).toBe(1);
    });
  });

  test("a malformed local declaration carries exactly one Remedy: and one Context: line", async () => {
    await withFixture(async (fx) => {
      buildMalformed(fx);
      const rows = siblingRows(await runPlanShipCoherenceProbe(fx.a));
      expect(rows.length).toBe(1);
      const { message } = rows[0]!;
      expect(labelled(message, "Remedy"), message).toBe(1);
      expect(labelled(message, "Context"), message).toBe(1);
      expect(labelled(message, "Refusing"), "the parser's refusal is spliced in whole").toBe(0);
    });
  });

  test("a sibling whose OWN declaration refuses: one disagreement row carrying that refusal", async () => {
    await withFixture(async (fx) => {
      localStamped(fx);
      const siblingFile = writePlan(fx.b, "archive", MILESTONE, {
        spansRaw: MALFORMED_SPANS_LINE,
        shippedIn: null,
      });
      let refusal = "";
      try {
        readSpansReposDeclaration(read(siblingFile));
      } catch (e) {
        expect(e).toBeInstanceOf(SpansReposError);
        refusal = (e as Error).message;
      }
      expect(refusal, "the sibling fixture's declaration does not actually refuse").not.toBe("");
      const refusing = refusal.split("\n")[0]!.replace(/^Refusing: /, "");

      const report = await runPlanShipCoherenceProbe(fx.a);
      const rows = siblingRows(report);
      expect(rows.length, describeReport(report)).toBe(1);
      const row = rows[0]!;
      expect(row.reason).toContain(DISAGREE);
      expect(row.reason).toContain(B_NAME);
      // Each reason carries only its own trigger's phrase (AC.13).
      expect(row.reason).not.toContain(NO_PLAN);
      expect(row.reason).not.toContain(MALFORMED);
      expect(row.message, "the sibling's refusal is dropped, so the remedy points at the wrong fix").toContain(
        refusing,
      );
      expect(labelled(row.message, "Remedy"), row.message).toBe(1);
      expect(labelled(row.message, "Context"), row.message).toBe(1);
      expect(labelled(row.message, "Refusing"), row.message).toBe(0);
    });
  });

  test("an unreadable sibling plan path never throws: it reads as no plan", async () => {
    await withFixture(async (fx) => {
      localStamped(fx);
      // A DIRECTORY where the sibling's archived plan file belongs, so reading it fails.
      mkdirSync(join(fx.b, "specs", "plan", "archive", `${MILESTONE}.md`), { recursive: true });
      const pending = runPlanShipCoherenceProbe(fx.a);
      await expect(pending).resolves.toBeDefined();
      const rows = siblingRows(await pending);
      expect(rows.length).toBe(1);
      expect(rows[0]!.reason).toContain(NO_PLAN);
    });
  });
});

// ===========================================================================
// AC-STE-588.7 — the note arms
// ===========================================================================

describe("AC-STE-588.7 — pending siblings are notes, aggregated, and never silent", () => {
  const unshippedStamps: Array<[string, string | null | undefined]> = [
    ["absent", undefined],
    ["null", null],
    ['"" (quoted)', '""'],
    ["empty (bare key)", ""],
    ["malformed (no v)", "2.83.0"],
    ["malformed (not a version)", "vNext"],
  ];
  for (const [label, stamp] of unshippedStamps) {
    test(`an agreeing sibling whose shipped_in: is ${label} is noted as (unshipped)`, async () => {
      await withFixture(async (fx) => {
        localStamped(fx);
        writePlan(fx.b, "archive", MILESTONE, { spans: spansBtoA(fx), shippedIn: stamp });
        const report = await runPlanShipCoherenceProbe(fx.a);
        expect(report.violations, describeReport(report)).toEqual([]);
        expect(siblingNotes(report)).toEqual([`${NOTE_PREFIX}${MILESTONE} → ${B_NAME} (unshipped)`]);
      });
    });
  }

  test("an unlocatable sibling is noted as (unlocatable), with zero violations", async () => {
    await withFixture(async (fx) => {
      localStamped(fx, MILESTONE, { spans: { [A_NAME]: ".", [B_NAME]: nowhere(fx, 0) } });
      const report = await runPlanShipCoherenceProbe(fx.a);
      expect(report.violations, describeReport(report)).toEqual([]);
      expect(siblingNotes(report)).toEqual([`${NOTE_PREFIX}${MILESTONE} → ${B_NAME} (unlocatable)`]);
    });
  });

  test("two plans with pending siblings produce ONE notes row naming both", async () => {
    await withFixture(async (fx) => {
      localStamped(fx, MILESTONE);
      writePlan(fx.b, "live", MILESTONE, { spans: spansBtoA(fx), shippedIn: null });
      localStamped(fx, SECOND, { spans: { [A_NAME]: ".", [C_NAME]: nowhere(fx, 0) } });
      const report = await runPlanShipCoherenceProbe(fx.a);
      expect(report.violations, describeReport(report)).toEqual([]);
      expect(noteEntries(report)).toEqual(
        [`${MILESTONE} → ${B_NAME} (unshipped)`, `${SECOND} → ${C_NAME} (unlocatable)`].sort(),
      );
    });
  });

  test("never silent: ship_partial: true with every sibling unlocatable still notes each one", async () => {
    await withFixture(async (fx) => {
      localStamped(fx, MILESTONE, {
        spans: { [A_NAME]: ".", [B_NAME]: nowhere(fx, 0), [C_NAME]: nowhere(fx, 1) },
        extra: { ship_partial: "true" },
      });
      const report = await runPlanShipCoherenceProbe(fx.a);
      expect(report.violations, describeReport(report)).toEqual([]);
      expect(noteEntries(report)).toEqual(
        [`${MILESTONE} → ${B_NAME} (unlocatable)`, `${MILESTONE} → ${C_NAME} (unlocatable)`].sort(),
      );
    });
  });
});

// ===========================================================================
// AC-STE-588.8 — the union of the sibling's two plan paths
// ===========================================================================

describe("AC-STE-588.8 — the sibling plan is read at its live AND its archive path", () => {
  test("an unshipped sibling plan is noted identically at either path", async () => {
    const run = (where: Where) =>
      withFixture(async (fx) => {
        localStamped(fx);
        writePlan(fx.b, where, MILESTONE, { spans: spansBtoA(fx), shippedIn: null });
        return runPlanShipCoherenceProbe(fx.a);
      });
    const live = await run("live");
    const archived = await run("archive");
    const expected = [`${NOTE_PREFIX}${MILESTONE} → ${B_NAME} (unshipped)`];
    expect(siblingNotes(live), describeReport(live)).toEqual(expected);
    expect(siblingNotes(archived), describeReport(archived)).toEqual(expected);
    expect(live.violations).toEqual([]);
    expect(archived.violations).toEqual([]);
  });

  for (const where of ["live", "archive"] as const) {
    test(`a sibling plan at the ${where} path carrying a well-formed stamp yields no row and no note`, async () => {
      await withFixture(async (fx) => {
        localStamped(fx);
        writePlan(fx.b, where, MILESTONE, { spans: spansBtoA(fx), shippedIn: "v1.4.0" });
        const report = await runPlanShipCoherenceProbe(fx.a);
        expect(report.violations, describeReport(report)).toEqual([]);
        expect(siblingNotes(report)).toEqual([]);
      });
    });
  }
});

// ===========================================================================
// AC-STE-588.9 — every row names the LOCAL plan, and resume selects it
// ===========================================================================

describe("AC-STE-588.9 — sibling rows carry the local plan's identity", () => {
  const triggers: Array<[string, (fx: SpanFixture) => void]> = [
    ["no plan", (fx) => buildNoPlan(fx)],
    ["disagreement", buildDisagreeUndeclared],
    ["malformed", (fx) => void buildMalformed(fx)],
  ];
  for (const [label, build] of triggers) {
    test(`the ${label} row names the local archived plan and surfaces in classifyResume`, async () => {
      await withFixture(async (fx) => {
        build(fx);
        const report = await runPlanShipCoherenceProbe(fx.a);
        const rows = siblingRows(report);
        expect(rows.length, describeReport(report)).toBe(1);
        const row = rows[0]!;
        expect(basename(row.file, ".md")).toBe(MILESTONE);
        const rel = relative(fx.a, row.file);
        expect(rel.startsWith(".."), `row.file ${row.file} is outside root A`).toBe(false);
        expect(rel).toBe(join("specs", "plan", "archive", `${MILESTONE}.md`));

        const resume = await classifyResume(fx.a, MILESTONE);
        expect(resume.shipCoherenceViolations).toContain(row.message);
      });
    });
  }
});

// ===========================================================================
// AC-STE-588.10 — MUTATION: a probe that skips the sibling leg
// ===========================================================================
//
// The mutant is the shipped module with its `./spans_repos` import pointed at a
// stub whose `resolveSpansRepos` resolves no sibling at all — the leg runs but
// can see nothing, which is what "skipped" means from the outside. Every other
// relative import is pointed at the real module by absolute path, so the only
// difference between the two is the one this test names.

describe("AC-STE-588.10 — the AC.4 fixture kills a mutant that skips the sibling leg", () => {
  test("the mutant differs, fails the AC.4 fixture, and the healthy twin passes under both", async () => {
    await withFixture(async (fx) => {
      const original = read(PROBE_MODULE);
      const stubPath = join(fx.a, "spans_stub.ts");
      writeFileSync(
        stubPath,
        [
          `export * from ${JSON.stringify(SPANS_MODULE)};`,
          "export async function resolveSpansRepos(): Promise<never[]> {",
          "  return [];",
          "}",
          "",
        ].join("\n"),
      );
      let stubbed = 0;
      const mutantSrc = original.replace(/from\s*"\.\/([^"]+)"/g, (_all, spec: string) => {
        if (spec === "spans_repos") {
          stubbed++;
          return `from ${JSON.stringify(stubPath)}`;
        }
        return `from ${JSON.stringify(join(SHARED_SRC, spec))}`;
      });
      // The mutation must really apply, or a pass below means nothing.
      expect(stubbed, "the module has no `./spans_repos` import to mutate").toBeGreaterThan(0);
      expect(mutantSrc).not.toBe(original);
      const mutantPath = join(fx.a, "plan_ship_coherence_mutant.ts");
      writeFileSync(mutantPath, mutantSrc);
      const mutant = (await import(mutantPath)) as {
        runPlanShipCoherenceProbe: typeof runPlanShipCoherenceProbe;
      };

      // The AC.4 fixture: the original yields its row, the mutant does not.
      buildNoPlan(fx);
      const realReport = await runPlanShipCoherenceProbe(fx.a);
      const mutantReport = await mutant.runPlanShipCoherenceProbe(fx.a);
      expect(siblingRows(realReport).length, describeReport(realReport)).toBe(1);
      expect(
        siblingRows(mutantReport).length,
        "the mutant still yields the no-plan row — the leg does not depend on resolveSpansRepos",
      ).toBe(0);

      // The healthy twin, in a second pair of roots: clean under both.
      await withFixture(async (twin) => {
        buildHealthyTwin(twin);
        for (const report of [
          await runPlanShipCoherenceProbe(twin.a),
          await mutant.runPlanShipCoherenceProbe(twin.a),
        ]) {
          expect(report.violations, describeReport(report)).toEqual([]);
          expect(siblingNotes(report)).toEqual([]);
        }
      });
    });
  });
});

// ===========================================================================
// AC-STE-588.11 — the STE-574 dogfood-scope suite knows the fourth kind
// ===========================================================================

describe("AC-STE-588.11 — the dogfood-scope suite carries four kinds", () => {
  const src = (): string => read(DOGFOOD_SCOPE_SUITE);

  test("KINDS holds four entries including sibling_unshipped", () => {
    const m = /const KINDS = \[([^\]]*)\] as const;/.exec(src());
    expect(m, "no `const KINDS = [...] as const;` in the dogfood-scope suite").not.toBeNull();
    const kinds = [...m![1]!.matchAll(/"([a-z_]+)"/g)].map((x) => x[1]!);
    expect(kinds.length).toBe(4);
    expect(kinds).toContain(KIND);
  });

  test("neither observed-kind tail compares the observed set to KINDS by equality any more", () => {
    expect(src()).not.toContain("expect(kindsOf(report.violations)).toEqual([...KINDS]);");
  });

  test("no test title in the file still says 'three kinds'", () => {
    const titles = [...src().matchAll(/\b(?:test|describe)\(\s*(["'`])((?:(?!\1).)*)\1/g)].map((m) => m[2]!);
    expect(titles.length, "no titles parsed — the reader is blind").toBeGreaterThan(10);
    expect(titles.filter((t) => /three kinds/i.test(t))).toEqual([]);
  });
});

// ===========================================================================
// AC-STE-588.12 — the probe #63 row states the sibling leg, in place
// ===========================================================================

describe("AC-STE-588.12 — skills/gate-check/SKILL.md probe #63 row", () => {
  const body = (): string => readFileSync(GATE_SKILL, "utf-8");

  function row63(): string {
    const lines = body().split("\n");
    const start = lines.findIndex((l) => /^63\. \*\*/.test(l));
    expect(start, "no `63. **` row").toBeGreaterThanOrEqual(0);
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (/^\d+\. \*\*/.test(lines[i]!)) {
        end = i;
        break;
      }
    }
    return lines.slice(start, end).join("\n");
  }

  test("the row names the sibling_unshipped kind and the siblings-awaiting-release note", () => {
    const row = row63();
    expect(row).toContain("`sibling_unshipped`");
    expect(row).toContain("siblings awaiting release:");
  });

  test("the row states the sibling leg's vacuity condition", () => {
    expect(row63()).toMatch(/sibling leg[^.;]*\bvacuous\b[^.;]*`spans_repos:?`/i);
  });

  test("edited in place: 356 split-lines, probe #26 on line 81, probe #63 on line 150, 85 rows", () => {
    const lines = body().split("\n");
    expect(lines.length).toBe(356);
    expect(lines[80]!).toMatch(/^26\. /);
    expect(lines[149]!).toMatch(/^63\. \*\*/);
    expect(lines.filter((l) => /^\d+\. \*\*/.test(l)).length).toBe(85);
    expect(lines.some((l) => /^86\. /.test(l))).toBe(false);
  });
});

// ===========================================================================
// AC-STE-588.13 — three reasons, each identifiable from the row alone
// ===========================================================================

describe("AC-STE-588.13 — the three violation reasons are distinct", () => {
  test("no plan, disagreement and malformed carry three distinct, self-identifying reasons", async () => {
    const reasonOf = (build: (fx: SpanFixture) => void) =>
      withFixture(async (fx) => {
        build(fx);
        const rows = siblingRows(await runPlanShipCoherenceProbe(fx.a));
        expect(rows.length).toBe(1);
        return rows[0]!.reason;
      });
    const reasons: Record<string, string> = {
      [NO_PLAN]: await reasonOf((fx) => buildNoPlan(fx)),
      [DISAGREE]: await reasonOf(buildDisagreeUndeclared),
      [MALFORMED]: await reasonOf((fx) => void buildMalformed(fx)),
    };
    expect(new Set(Object.values(reasons)).size).toBe(3);
    const phrases = Object.keys(reasons);
    for (const [own, reason] of Object.entries(reasons)) {
      expect(reason, `the ${own} reason lacks its own phrase`).toContain(own);
      for (const other of phrases.filter((p) => p !== own)) {
        expect(reason, `the ${own} reason also says "${other}" — not identifiable alone`).not.toContain(other);
      }
    }
  });
});
