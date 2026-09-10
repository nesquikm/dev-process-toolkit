// M_79b1f6 / STE-589 — a release refuses while its sibling still holds active work.
//
// THE DEFECT, stated once: `/ship-milestone` could stamp a two-repository
// milestone as shipped while the sibling repository still had FRs in flight.
// Refusal #4 closes it by reading THE sibling predicate, `spanningSiblingState`
// — a sibling holding active FRs bound to the milestone — and never "the sibling
// has not shipped", which would deadlock two repos that each wait for the other.
//
// THE CONTRACT these tests build to:
//
//   * `siblingShipGate({ projectRoot, planBody, milestone, partial })` in
//     `adapters/_shared/src/sibling_release.ts` is async and resolves to
//     `{ refusal: string | null; footer: string[]; unchecked: string[] }`.
//       refusal   — null when the gate passes; otherwise three lines in the
//                   ship-milestone house shape: `/ship-milestone: …`,
//                   `Remedy: …`, `Context: … skill=ship-milestone`.
//       footer    — one `Spans: <name>@<value>` line per NON-SELF declared
//                   entry, in declaration order; `<value>` is the sibling
//                   plan's well-formed `v<X.Y.Z>` stamp, else `pending`.
//       unchecked — one line per unlocatable sibling, saying it was not
//                   checked; the front door prints these on stderr.
//   * The front door, `bun run adapters/_shared/src/sibling_release.ts
//     <projectRoot> <planFile> <milestone> [--partial]`: refused ⇒ exit 1, the
//     refusal on stderr, empty stdout; otherwise exit 0, footer on stdout,
//     unchecked lines on stderr.
//   * `stampShipPartial(planPath)` in `plan_ship_stamp.ts` writes the BARE
//     scalar `ship_partial: true` (STE-588's probe reads only the bare `true`),
//     is idempotent, and keeps every other byte.
//
// Every tree is a pair of REAL temp roots from `tests/_span_fixture.ts`, torn
// down in a `finally`; no temp directory is hand-named here.
//
// Filter by AC with `bun test -t "AC-STE-589.N"`.

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { spanningSiblingState } from "../adapters/_shared/src/active_plan_ship_ready";
import {
  ORDERED_UNREACHABLE_PIN,
  runModuleReachabilityProbe,
} from "../adapters/_shared/src/module_reachability";
import {
  runPlanShipCoherenceProbe,
  type PlanShipCoherenceReport,
} from "../adapters/_shared/src/plan_ship_coherence";
import * as planShipStamp from "../adapters/_shared/src/plan_ship_stamp";
import { classifyResume, resumeChain } from "../adapters/_shared/src/resume_classifier";
// Namespace import: a missing export must fail each test by name, not crash
// the whole file at link time.
import * as siblingRelease from "../adapters/_shared/src/sibling_release";
import { SpansReposError, readSpansReposDeclaration } from "../adapters/_shared/src/spans_repos";
import { type SpanFixture, makeSpanFixture } from "./_span_fixture";

// ===========================================================================
// Paths.
// ===========================================================================

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const SHARED_SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src");
const SIBLING_MODULE = join(SHARED_SRC, "sibling_release.ts");
const STAMP_MODULE = join(SHARED_SRC, "plan_ship_stamp.ts");
/** The front door, as the skill orders it: by its path, run from the plugin root. */
const FRONT_DOOR = "adapters/_shared/src/sibling_release.ts";
const SKILL = join(PLUGIN_ROOT, "skills", "ship-milestone", "SKILL.md");
const REFERENCE = join(PLUGIN_ROOT, "docs", "ship-milestone-reference.md");
const LAYOUT = join(PLUGIN_ROOT, "docs", "layout-reference.md");
const HOOK = join(PLUGIN_ROOT, "templates", "git-hooks", "commit-msg.sh");
const SHAPE_SUITE = "tests/ship-milestone-shape.test.ts";

/** Text as it sits on disk — BOM and line endings untouched. */
const read = (p: string): string => readFileSync(p).toString("utf-8");
/** Text with CRLF folded, for prose assertions. */
const readLf = (p: string): string => read(p).replace(/\r\n/g, "\n");

// ===========================================================================
// Vocabulary.
// ===========================================================================

const MILESTONE = "M_GF_79";
const A_NAME = "glacy-app-fe";
const B_NAME = "glacy-app-be";
/**
 * Declared AFTER B in every map that names it, while sorting BEFORE it
 * alphabetically — so a footer in declaration order and a sorted footer differ.
 */
const C_NAME = "glacy-app-api";

const FR_DONE_A = "STE-9000";
const FR_DONE_B = "STE-9100";
const FR_1 = "STE-9101";
const FR_2 = "STE-9102";

const LOCAL_VERSION = "2.83.0";
const CHANGELOG = [
  "# Changelog",
  "",
  `## [${LOCAL_VERSION}] — 2026-09-10 — "Fixture"`,
  "",
  "- something",
  "",
].join("\n");

/** A flow list: the shared parser hands it back as a STRING, which refuses. */
const MALFORMED_SPANS_LINE = `spans_repos: [${A_NAME}, ${B_NAME}]`;

// ===========================================================================
// The two contract surfaces this FR adds, reached through the namespaces.
// ===========================================================================

interface GateInput {
  readonly projectRoot: string;
  readonly planBody: string;
  readonly milestone: string;
  readonly partial: boolean;
}

interface GateResult {
  readonly refusal: string | null;
  readonly footer: readonly string[];
  readonly unchecked: readonly string[];
}

function exported<T>(ns: object, name: string, module: string): T {
  const fn = (ns as Record<string, unknown>)[name];
  if (typeof fn !== "function") {
    throw new Error(`${module} exports no \`${name}\` function`);
  }
  return fn as T;
}

const siblingShipGate = (input: GateInput): Promise<GateResult> =>
  exported<(i: GateInput) => Promise<GateResult>>(
    siblingRelease,
    "siblingShipGate",
    "adapters/_shared/src/sibling_release.ts",
  )(input);

const stampShipPartial = (planPath: string): Promise<void> =>
  exported<(p: string) => Promise<void>>(
    planShipStamp,
    "stampShipPartial",
    "adapters/_shared/src/plan_ship_stamp.ts",
  )(planPath);

const { stampShippedIn } = planShipStamp;

// ===========================================================================
// Tree builders.
// ===========================================================================

type Where = "live" | "archive";

/**
 * Write a plan for `token` under `root`. `shippedIn: undefined` OMITS the key,
 * `null` writes the template sentinel, and any string is written verbatim after
 * the colon (`'""'` is the quoted empty value, `""` the bare key). An empty
 * `spans` record omits `spans_repos:`; `spansRaw` writes the key's line verbatim.
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
    lines.push(
      opts.shippedIn === null ? "shipped_in: null" : `shipped_in: ${opts.shippedIn}`.trimEnd(),
    );
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

const spansAtoB = (fx: SpanFixture): Record<string, string> => ({
  [A_NAME]: ".",
  [B_NAME]: relative(fx.a, fx.b),
});

const spansBtoA = (fx: SpanFixture): Record<string, string> => ({
  [A_NAME]: relative(fx.b, fx.a),
  [B_NAME]: ".",
});

/** A path that locates nothing: root B's relative path plus a digit. */
const nowhere = (fx: SpanFixture, n: number): string => `${relative(fx.a, fx.b)}${n}`;

/**
 * A's live plan spanning B; B's plan naming A back; B carries one archived FR
 * and `busy` active FRs bound to the milestone. Returns A's plan file.
 */
function buildSpan(
  fx: SpanFixture,
  opts: { busy?: number; bStamp?: string | null | undefined; bWhere?: Where } = {},
): string {
  const aPlan = writePlan(fx.a, "live", MILESTONE, { spans: spansAtoB(fx), shippedIn: null });
  fx.archivedFr(fx.a, FR_DONE_A, MILESTONE);
  writePlan(fx.b, opts.bWhere ?? "live", MILESTONE, {
    spans: spansBtoA(fx),
    shippedIn: "bStamp" in opts ? opts.bStamp : null,
  });
  fx.archivedFr(fx.b, FR_DONE_B, MILESTONE);
  for (const id of [FR_1, FR_2].slice(0, opts.busy ?? 0)) fx.activeFr(fx.b, id, MILESTONE);
  return aPlan;
}

async function withFixture<T>(body: (fx: SpanFixture) => Promise<T>): Promise<T> {
  const fx = makeSpanFixture(MILESTONE);
  try {
    return await body(fx);
  } finally {
    fx.cleanup();
  }
}

const gateFrom = (root: string, planFile: string, partial = false): Promise<GateResult> =>
  siblingShipGate({ projectRoot: root, planBody: read(planFile), milestone: MILESTONE, partial });

interface DoorRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Spawn the front door exactly as the skill orders it. */
function frontDoor(projectRoot: string, planFile: string, partial = false): DoorRun {
  const args = ["run", FRONT_DOOR, projectRoot, planFile, MILESTONE];
  if (partial) args.push("--partial");
  const proc = spawnSync("bun", args, { cwd: PLUGIN_ROOT, encoding: "utf-8" });
  return { status: proc.status, stdout: proc.stdout ?? "", stderr: proc.stderr ?? "" };
}

const nonEmptyLines = (s: string): string[] => s.split("\n").filter((l) => l.trim() !== "");

const describeDoor = (d: DoorRun): string =>
  `exit=${d.status}\n--- stdout ---\n${d.stdout}\n--- stderr ---\n${d.stderr}`;

/** The refusal's lines, one trailing newline tolerated. Fails when the gate passed. */
function refusalLines(refusal: string | null): string[] {
  expect(refusal, "expected a refusal; the gate passed").not.toBeNull();
  return refusal!.replace(/\n+$/, "").split("\n");
}

/** Assert the ship-milestone house shape and return the three lines. */
function expectHouseShape(refusal: string | null): string[] {
  const lines = refusalLines(refusal);
  expect(lines.length, refusal ?? "").toBe(3);
  expect(lines[0]!).toMatch(/^\/ship-milestone: /);
  expect(lines[1]!).toMatch(/^Remedy: /);
  expect(lines[2]!).toMatch(/^Context: /);
  expect(lines[2]!).toMatch(/skill=ship-milestone$/);
  return lines;
}

/** The `Refusing:` line body the spans_repos reader throws for `planBody`. */
function readerRefusingBody(planBody: string): string {
  let message = "";
  try {
    readSpansReposDeclaration(planBody);
  } catch (e) {
    expect(e).toBeInstanceOf(SpansReposError);
    message = (e as Error).message;
  }
  expect(message, "the fixture's declaration does not actually refuse").not.toBe("");
  const refusing = message.split("\n").find((l) => l.startsWith("Refusing: "));
  expect(refusing, message).toBeDefined();
  return refusing!.slice("Refusing: ".length);
}

/** Strip `//` line comments and block comments, keeping string contents. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
}

const describeReport = (r: PlanShipCoherenceReport): string =>
  `violations:\n${r.violations.map((v) => `  - [${v.kind}] ${v.reason}`).join("\n") || "  (none)"}\n` +
  `notes:\n${r.notes.map((n) => `  - ${n}`).join("\n") || "  (none)"}`;

// ===========================================================================
// AC-STE-589.1 — the gate refuses exactly on the ONE sibling predicate
// ===========================================================================

describe("AC-STE-589.1 — siblingShipGate refuses exactly when a sibling is busy and --partial is absent", () => {
  test("sibling_release.ts imports spanningSiblingState and walks no FR directory itself", () => {
    const code = stripComments(readLf(SIBLING_MODULE));
    expect(code).toMatch(
      /import\s*\{[^}]*\bspanningSiblingState\b[^}]*\}\s*from\s*"\.\/active_plan_ship_ready"/,
    );
    expect(code, "sibling_release.ts calls milestoneFrBinding itself").not.toMatch(
      /\bmilestoneFrBinding\b/,
    );
    expect(code, "sibling_release.ts lists a directory itself").not.toMatch(/\breaddir(?:Sync)?\b/);
    expect(code, "sibling_release.ts names the FR directory itself").not.toMatch(/["'`]frs["'`]/);
  });

  const corners: Array<[busy: boolean, partial: boolean, refuses: boolean]> = [
    [true, false, true],
    [true, true, false],
    [false, false, false],
    [false, true, false],
  ];
  for (const [busy, partial, refuses] of corners) {
    test(`sibling ${busy ? "busy" : "idle"}, partial=${partial}: the gate ${refuses ? "refuses" : "passes"}`, async () => {
      await withFixture(async (fx) => {
        const plan = buildSpan(fx, { busy: busy ? 1 : 0 });
        // The fixture agrees with THE predicate, so the corner is the one named.
        const predicate = await spanningSiblingState(fx.a, read(plan), MILESTONE);
        expect(predicate.busy.length > 0, JSON.stringify(predicate)).toBe(busy);
        const result = await gateFrom(fx.a, plan, partial);
        expect(result.refusal !== null, result.refusal ?? "(the gate passed)").toBe(refuses);
      });
    });
  }

  test("the predicate is active FRs, never the stamp: a STAMPED sibling still holding active FRs refuses", async () => {
    await withFixture(async (fx) => {
      const plan = buildSpan(fx, { busy: 1, bStamp: "v1.4.0" });
      const result = await gateFrom(fx.a, plan);
      expect(result.refusal, "a stamped-but-busy sibling passed the gate").not.toBeNull();
    });
  });
});

// ===========================================================================
// AC-STE-589.2 — the refusal's three lines
// ===========================================================================

describe("AC-STE-589.2 — the busy refusal is the NFR-10 three-line house shape", () => {
  test("the verdict names milestone, sibling, active count and FR ids; the Remedy names finishing and --partial", async () => {
    await withFixture(async (fx) => {
      const plan = buildSpan(fx, { busy: 2 });
      const [verdict, remedy, context] = expectHouseShape((await gateFrom(fx.a, plan)).refusal);
      expect(verdict!).toContain(MILESTONE);
      expect(verdict!).toContain(B_NAME);
      expect(verdict!, "the verdict does not carry the active count").toMatch(
        /\b2\b[^\n]*\bactive\b|\bactive\b[^\n]*\b2\b/,
      );
      expect(verdict!).toContain(FR_1);
      expect(verdict!).toContain(FR_2);
      // The archived FR is finished work: the verdict does not name it.
      expect(verdict!).not.toContain(FR_DONE_B);
      expect(remedy!).toMatch(/\bfinish/i);
      expect(remedy!).toContain("--partial");
      expect(context!).toMatch(/^Context: .*skill=ship-milestone$/);
    });
  });

  test("the verdict names the BUSY sibling, not an idle one declared beside it", async () => {
    await withFixture(async (fx) => {
      const other = makeSpanFixture(MILESTONE);
      try {
        const c = other.a;
        const plan = writePlan(fx.a, "live", MILESTONE, {
          spans: { [A_NAME]: ".", [B_NAME]: relative(fx.a, fx.b), [C_NAME]: relative(fx.a, c) },
          shippedIn: null,
        });
        writePlan(fx.b, "live", MILESTONE, { spans: spansBtoA(fx), shippedIn: null });
        fx.activeFr(fx.b, FR_1, MILESTONE);
        writePlan(c, "live", MILESTONE, { spans: { [A_NAME]: relative(c, fx.a), [C_NAME]: "." }, shippedIn: null });
        other.archivedFr(c, FR_DONE_B, MILESTONE);
        const [verdict] = expectHouseShape((await gateFrom(fx.a, plan)).refusal);
        expect(verdict!).toContain(B_NAME);
        expect(verdict!).not.toContain(C_NAME);
      } finally {
        other.cleanup();
      }
    });
  });

  test("a refused run renders no footer; the same span under --partial does", async () => {
    await withFixture(async (fx) => {
      const plan = buildSpan(fx, { busy: 1 });
      const refused = await gateFrom(fx.a, plan);
      expectHouseShape(refused.refusal);
      expect(refused.footer).toEqual([]);
      // Control: the footer is still measured whenever the gate lets the run through.
      expect((await gateFrom(fx.a, plan, true)).footer).toEqual([`Spans: ${B_NAME}@pending`]);
    });
  });
});

// ===========================================================================
// AC-STE-589.3 — degrade, never crash
// ===========================================================================

describe("AC-STE-589.3 — unlocatable, undeclared and malformed declarations", () => {
  test("an unlocatable sibling does not refuse, and yields one not-checked line naming it", async () => {
    await withFixture(async (fx) => {
      const plan = writePlan(fx.a, "live", MILESTONE, {
        spans: { [A_NAME]: ".", [B_NAME]: nowhere(fx, 0) },
        shippedIn: null,
      });
      const result = await gateFrom(fx.a, plan);
      expect(result.refusal).toBeNull();
      expect(result.unchecked.length, JSON.stringify(result.unchecked)).toBe(1);
      expect(result.unchecked[0]!).toContain(B_NAME);
      expect(result.unchecked[0]!).toMatch(/not checked/i);
    });
  });

  test("every unlocatable sibling gets its own line; a located sibling gets none", async () => {
    await withFixture(async (fx) => {
      const plan = writePlan(fx.a, "live", MILESTONE, {
        spans: { [A_NAME]: ".", [B_NAME]: nowhere(fx, 0), [C_NAME]: nowhere(fx, 1) },
        shippedIn: null,
      });
      const result = await gateFrom(fx.a, plan);
      expect(result.refusal).toBeNull();
      expect(result.unchecked.length, JSON.stringify(result.unchecked)).toBe(2);
      for (const name of [B_NAME, C_NAME]) {
        expect(result.unchecked.filter((l) => l.includes(name)).length, name).toBe(1);
      }
    });
  });

  test("front door: an all-unlocatable span exits 0 and is never a silent pass", async () => {
    await withFixture(async (fx) => {
      const plan = writePlan(fx.a, "live", MILESTONE, {
        spans: { [A_NAME]: ".", [B_NAME]: nowhere(fx, 0), [C_NAME]: nowhere(fx, 1) },
        shippedIn: null,
      });
      const inProcess = await gateFrom(fx.a, plan);
      const door = frontDoor(fx.a, plan);
      expect(door.status, describeDoor(door)).toBe(0);
      const errLines = nonEmptyLines(door.stderr);
      expect(errLines.length, describeDoor(door)).toBe(2);
      for (const line of errLines) expect(line).toMatch(/not checked/i);
      expect([...errLines].sort()).toEqual([...inProcess.unchecked].sort());
    });
  }, 30_000);

  test("front door: a span whose siblings all locate prints no not-checked line", async () => {
    await withFixture(async (fx) => {
      const plan = buildSpan(fx);
      const result = await gateFrom(fx.a, plan);
      expect(result.refusal).toBeNull();
      expect(result.unchecked).toEqual([]);
      const door = frontDoor(fx.a, plan);
      expect(door.status, describeDoor(door)).toBe(0);
      expect(door.stderr, describeDoor(door)).toBe("");
      // Non-vacuity: the run really read the span — it printed B's footer.
      expect(nonEmptyLines(door.stdout)).toEqual([`Spans: ${B_NAME}@pending`]);
    });
  }, 30_000);

  test("an undeclared plan does not refuse and yields zero footer and zero not-checked lines", async () => {
    await withFixture(async (fx) => {
      const plan = writePlan(fx.a, "live", MILESTONE, { spans: {}, shippedIn: null });
      const result = await gateFrom(fx.a, plan);
      expect(result).toEqual({ refusal: null, footer: [], unchecked: [] });
      const door = frontDoor(fx.a, plan);
      expect(door.status, describeDoor(door)).toBe(0);
      expect(door.stdout).toBe("");
      expect(door.stderr).toBe("");
    });
  }, 30_000);

  for (const partial of [false, true]) {
    test(`a malformed declaration refuses with the reader's own text, never a throw (partial=${partial})`, async () => {
      await withFixture(async (fx) => {
        const plan = writePlan(fx.a, "live", MILESTONE, {
          spansRaw: MALFORMED_SPANS_LINE,
          shippedIn: null,
        });
        const refusing = readerRefusingBody(read(plan));
        const pending = gateFrom(fx.a, plan, partial);
        await expect(pending).resolves.toBeDefined();
        const { refusal } = await pending;
        expectHouseShape(refusal);
        expect(refusal!, "the refusal drops the reader's Refusing: text").toContain(refusing);
      });
    });
  }

  test("front door: a malformed declaration exits 1 with the reader's text on stderr and empty stdout", async () => {
    await withFixture(async (fx) => {
      const plan = writePlan(fx.a, "live", MILESTONE, { spansRaw: MALFORMED_SPANS_LINE, shippedIn: null });
      const refusing = readerRefusingBody(read(plan));
      const door = frontDoor(fx.a, plan);
      expect(door.status, describeDoor(door)).toBe(1);
      expect(door.stdout).toBe("");
      expect(door.stderr).toContain(refusing);
    });
  }, 30_000);
});

// ===========================================================================
// AC-STE-589.4 — --partial needs a second half
// ===========================================================================

describe("AC-STE-589.4 — --partial on a plan that declares no spans_repos: refuses", () => {
  const undeclared: Array<[string, Record<string, string>, string | undefined]> = [
    ["the key is absent", {}, undefined],
    ["the key is null", {}, "spans_repos: null"],
  ];
  for (const [label, spans, spansRaw] of undeclared) {
    test(`${label}: --partial refuses with its own verdict; without it the gate passes`, async () => {
      await withFixture(async (fx) => {
        const plan = writePlan(fx.a, "live", MILESTONE, { spans, spansRaw, shippedIn: null });
        // Control: the same plan without the flag passes, so the flag is the cause.
        expect((await gateFrom(fx.a, plan, false)).refusal).toBeNull();
        const refusal = (await gateFrom(fx.a, plan, true)).refusal;
        const [verdict] = expectHouseShape(refusal);
        expect(verdict!).toContain(MILESTONE);
        expect(refusal!).toContain("--partial");

        // Distinct from the busy-sibling refusal.
        const busyVerdict = await withFixture(async (busyFx) => {
          const busyPlan = buildSpan(busyFx, { busy: 1 });
          return refusalLines((await gateFrom(busyFx.a, busyPlan)).refusal)[0]!;
        });
        expect(verdict!).not.toBe(busyVerdict);
      });
    });
  }

  test("front door: --partial on an undeclared plan exits 1 with empty stdout", async () => {
    await withFixture(async (fx) => {
      const plan = writePlan(fx.a, "live", MILESTONE, { spans: {}, shippedIn: null });
      const door = frontDoor(fx.a, plan, true);
      expect(door.status, describeDoor(door)).toBe(1);
      expect(door.stdout).toBe("");
      expect(door.stderr).toContain("--partial");
    });
  }, 30_000);
});

// ===========================================================================
// AC-STE-589.5 — the front door
// ===========================================================================

describe("AC-STE-589.5 — the front door, spawned as a subprocess", () => {
  test("refused: exit 1, the gate's refusal on stderr, empty stdout", async () => {
    await withFixture(async (fx) => {
      const plan = buildSpan(fx, { busy: 1 });
      const inProcess = await gateFrom(fx.a, plan);
      expectHouseShape(inProcess.refusal);
      const door = frontDoor(fx.a, plan);
      expect(door.status, describeDoor(door)).toBe(1);
      expect(door.stdout, describeDoor(door)).toBe("");
      expect(door.stderr.trimEnd()).toBe(inProcess.refusal!.trimEnd());
    });
  }, 30_000);

  test("an unreadable plan file refuses in the house shape, never a stack trace", async () => {
    await withFixture(async (fx) => {
      const missing = join(fx.a, "specs", "plan", "no-such-plan.md");
      const door = frontDoor(fx.a, missing);
      expect(door.status, describeDoor(door)).toBe(1);
      expect(door.stdout, describeDoor(door)).toBe("");
      const [verdict] = expectHouseShape(door.stderr);
      expect(verdict!).toContain(missing);
      expect(door.stderr, describeDoor(door)).not.toMatch(/^\s+at /m);
    });
  }, 30_000);

  test("--partial on the busy span: exit 0, one Spans: line", async () => {
    await withFixture(async (fx) => {
      const plan = buildSpan(fx, { busy: 1 });
      const door = frontDoor(fx.a, plan, true);
      expect(door.status, describeDoor(door)).toBe(0);
      expect(nonEmptyLines(door.stdout)).toEqual([`Spans: ${B_NAME}@pending`]);
    });
  }, 30_000);

  test("passed: exit 0, one Spans: line per non-self entry, in declaration order", async () => {
    await withFixture(async (fx) => {
      const other = makeSpanFixture(MILESTONE);
      try {
        const c = other.a;
        const plan = writePlan(fx.a, "live", MILESTONE, {
          spans: { [A_NAME]: ".", [B_NAME]: relative(fx.a, fx.b), [C_NAME]: relative(fx.a, c) },
          shippedIn: null,
        });
        writePlan(fx.b, "archive", MILESTONE, { spans: spansBtoA(fx), shippedIn: "v1.4.0" });
        // C is located and holds no plan for the milestone.
        const expected = [`Spans: ${B_NAME}@v1.4.0`, `Spans: ${C_NAME}@pending`];

        const inProcess = await gateFrom(fx.a, plan);
        expect(inProcess.refusal).toBeNull();
        expect(inProcess.footer).toEqual(expected);

        const door = frontDoor(fx.a, plan);
        expect(door.status, describeDoor(door)).toBe(0);
        expect(nonEmptyLines(door.stdout)).toEqual(expected);
        expect(door.stderr, describeDoor(door)).toBe("");
      } finally {
        other.cleanup();
      }
    });
  }, 30_000);

  test("the skill orders the front door by path, and the reachability pin holds", async () => {
    expect(readLf(SKILL)).toContain(FRONT_DOOR);
    const report = await runModuleReachabilityProbe(REPO_ROOT);
    expect(report.orderedUnreachable).toBe(ORDERED_UNREACHABLE_PIN);
    expect(report.ok).toBe(true);
  }, 60_000);
});

// ===========================================================================
// AC-STE-589.6 — the footer is measured, never typed
// ===========================================================================

describe("AC-STE-589.6 — Spans: <name>@<value> reads the sibling plan's own stamp", () => {
  const arms: Array<[string, Where, string | null | undefined, string]> = [
    ["a well-formed stamp on the live plan", "live", "v1.4.0", "v1.4.0"],
    ["a well-formed stamp on the archived plan", "archive", "v1.4.0", "v1.4.0"],
    ["an absent stamp", "live", undefined, "pending"],
    ["a null stamp", "live", null, "pending"],
    ['a quoted "" stamp', "live", '""', "pending"],
    ["a bare empty stamp", "live", "", "pending"],
    ["a malformed stamp (no v)", "live", "2.83.0", "pending"],
    ["a malformed stamp (not a version)", "archive", "vNext", "pending"],
  ];
  for (const [label, where, stamp, value] of arms) {
    test(`${label} renders ${B_NAME}@${value}`, async () => {
      await withFixture(async (fx) => {
        const plan = buildSpan(fx, { bStamp: stamp, bWhere: where });
        const result = await gateFrom(fx.a, plan);
        expect(result.refusal).toBeNull();
        expect(result.footer).toEqual([`Spans: ${B_NAME}@${value}`]);
      });
    });
  }

  test("a located sibling with no plan renders pending", async () => {
    await withFixture(async (fx) => {
      const plan = writePlan(fx.a, "live", MILESTONE, { spans: spansAtoB(fx), shippedIn: null });
      const result = await gateFrom(fx.a, plan);
      expect(result.refusal).toBeNull();
      expect(result.footer).toEqual([`Spans: ${B_NAME}@pending`]);
    });
  });

  test("an unlocatable sibling renders pending", async () => {
    await withFixture(async (fx) => {
      const plan = writePlan(fx.a, "live", MILESTONE, {
        spans: { [A_NAME]: ".", [B_NAME]: nowhere(fx, 0) },
        shippedIn: null,
      });
      const result = await gateFrom(fx.a, plan);
      expect(result.footer).toEqual([`Spans: ${B_NAME}@pending`]);
    });
  });

  test("rewriting the sibling's on-disk shipped_in: turns pending into the version", async () => {
    await withFixture(async (fx) => {
      const plan = buildSpan(fx, { bStamp: null });
      const siblingPlan = join(fx.b, "specs", "plan", `${MILESTONE}.md`);
      expect((await gateFrom(fx.a, plan)).footer).toEqual([`Spans: ${B_NAME}@pending`]);

      const before = read(siblingPlan);
      writeFileSync(siblingPlan, before.replace(/^shipped_in: null$/m, "shipped_in: v1.5.0"));
      // The rewrite really applied before it is scored.
      const after = read(siblingPlan);
      expect(after).not.toBe(before);
      expect(after).toMatch(/^shipped_in: v1\.5\.0$/m);

      expect((await gateFrom(fx.a, plan)).footer).toEqual([`Spans: ${B_NAME}@v1.5.0`]);
    });
  });
});

// ===========================================================================
// AC-STE-589.7 — the skill body
// ===========================================================================

describe("AC-STE-589.7 — skills/ship-milestone/SKILL.md carries refusal #4, the flag and the footer", () => {
  const skillLines = (): string[] => readLf(SKILL).split("\n");

  /** The `## Pre-flight refusals` window, located by heading, never by line number. */
  function refusalsWindow(): string[] {
    const lines = skillLines();
    const start = lines.indexOf("## Pre-flight refusals");
    const end = lines.indexOf("## Flow");
    expect(start, "no `## Pre-flight refusals` heading").toBeGreaterThanOrEqual(0);
    expect(end, "no `## Flow` heading after the refusals").toBeGreaterThan(start);
    return lines.slice(start + 1, end);
  }

  /** The `4. **` block: from its line to the next top-level item or the window's end. */
  function refusalFour(): string {
    const win = refusalsWindow();
    const start = win.findIndex((l) => /^4\. \*\*/.test(l));
    expect(start, "the refusals window holds no `4. **` block").toBeGreaterThanOrEqual(0);
    let end = win.length;
    for (let i = start + 1; i < win.length; i++) {
      if (/^\d+\. \*\*/.test(win[i]!)) {
        end = i;
        break;
      }
    }
    return win.slice(start, end).join("\n");
  }

  test("refusal #4 runs the front door by its path", () => {
    const block = refusalFour();
    expect(block).toContain("bun run");
    expect(block).toContain(FRONT_DOOR);
  });

  test("refusal #4 names --partial as the only escape", () => {
    const block = refusalFour();
    expect(block).toContain("--partial");
    expect(block).toMatch(/--partial[\s\S]{0,200}\bonly\b|\bonly\b[\s\S]{0,200}--partial/i);
  });

  test("refusal #4 says why the predicate is active FRs: an unshipped predicate deadlocks", () => {
    const block = refusalFour();
    expect(block).toMatch(/\bactive FRs?\b/);
    expect(block).toMatch(/deadlock/i);
  });

  test("line 4's argument-hint carries [--partial]", () => {
    const line4 = skillLines()[3]!;
    expect(line4).toMatch(/^argument-hint: /);
    expect(line4).toContain("[--partial]");
  });

  test("the commit template carries `Spans: <repo>@<version|pending>` between Release: and Refs:", () => {
    const lines = skillLines();
    const subject = lines.indexOf("chore(release): v<X.Y.Z>");
    expect(subject, "no commit template subject line").toBeGreaterThanOrEqual(0);
    const fenceEnd = lines.findIndex((l, i) => i > subject && l.startsWith("```"));
    const template = lines.slice(subject, fenceEnd);
    const release = template.findIndex((l) => l.startsWith("Release: "));
    const spans = template.findIndex((l) => l.startsWith("Spans: "));
    const refs = template.findIndex((l) => l.startsWith("Refs: "));
    expect(release, template.join("\n")).toBeGreaterThanOrEqual(0);
    expect(spans, template.join("\n")).toBeGreaterThan(release);
    expect(refs, template.join("\n")).toBeGreaterThan(spans);
    expect(template[spans]).toBe("Spans: <repo>@<version|pending>");
  });

  test("the Footers bullet names three footers", () => {
    const bullet = skillLines().find((l) => l.startsWith("- **Footers**"));
    expect(bullet, "no `- **Footers**` bullet").toBeDefined();
    for (const footer of ["`Release: ", "`Spans: ", "`Refs: "]) {
      expect(bullet!, `the Footers bullet does not name ${footer}`).toContain(footer);
    }
  });

  test("tests/ship-milestone-shape.test.ts is unedited against main", () => {
    const proc = spawnSync("git", ["diff", "main", "--", SHAPE_SUITE], {
      cwd: PLUGIN_ROOT,
      encoding: "utf-8",
    });
    expect(proc.status, proc.stderr).toBe(0);
    expect(proc.stdout, "the shape suite was edited").toBe("");
  });

  test("tests/ship-milestone-shape.test.ts is green", () => {
    const proc = spawnSync("bun", ["test", SHAPE_SUITE], { cwd: PLUGIN_ROOT, encoding: "utf-8" });
    const out = `${proc.stdout}${proc.stderr}`;
    expect(proc.status, out.slice(-3000)).toBe(0);
    // Non-vacuity: a run that collected nothing exits 0 too.
    expect(out).toMatch(/\b[1-9]\d* pass\b/);
  }, 60_000);
});

// ===========================================================================
// AC-STE-589.8 — the partial stamp writer
// ===========================================================================

describe("AC-STE-589.8 — --partial stamps shipped_in: plus a bare ship_partial: true", () => {
  const FM_LF = [
    "---",
    `milestone: ${MILESTONE}`,
    "status: archived",
    "archived_at: 2026-09-10T00:00:00Z",
    "shipped_in: null",
    "migration: none",
    "---",
  ];
  const BODY_LF = ["", `# ${MILESTONE}`, "", "Body text.", "", "---", "", "After a rule.", ""];

  const variants: Array<[string, string, string]> = [
    ["LF", [...FM_LF, ...BODY_LF].join("\n"), "\n"],
    ["CRLF", [...FM_LF, ...BODY_LF].join("\r\n"), "\r\n"],
    ["CRLF frontmatter + LF body", `${FM_LF.join("\r\n")}\r\n${BODY_LF.join("\n")}`, "\r\n"],
    ["BOM", `﻿${[...FM_LF, ...BODY_LF].join("\n")}`, "\n"],
  ];

  const startsWithBom = (p: string): boolean => {
    const bytes = readFileSync(p);
    return bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  };

  for (const [label, input, eol] of variants) {
    test(`${label}: the only difference from stampShippedIn alone is one bare ship_partial: true line`, async () => {
      await withFixture(async (fx) => {
        const onlyFile = join(fx.a, "specs", "plan", `${MILESTONE}.md`);
        const partialFile = join(fx.b, "specs", "plan", `${MILESTONE}.md`);
        writeFileSync(onlyFile, input);
        writeFileSync(partialFile, input);

        await stampShippedIn(onlyFile, LOCAL_VERSION);
        await stampShippedIn(partialFile, LOCAL_VERSION);
        await stampShipPartial(partialFile);

        const only = read(onlyFile);
        const partial = read(partialFile);
        expect(partial, "the partial writer wrote nothing").not.toBe(only);
        const line = `ship_partial: true${eol}`;
        expect(partial.split(line).length - 1, partial).toBe(1);
        expect(partial, "the value is quoted, which the probe fails closed on").not.toMatch(
          /^ship_partial:\s*["']/m,
        );
        // Every other key and the whole body are byte-for-byte those of the
        // stampShippedIn-only run.
        expect(partial.replace(line, "")).toBe(only);
        // … and the line sits inside the frontmatter block.
        const close = partial.indexOf(`${eol}---${eol}`, 3);
        expect(close).toBeGreaterThan(0);
        expect(partial.indexOf(line)).toBeLessThan(close);
        expect(startsWithBom(partialFile)).toBe(startsWithBom(onlyFile));
        if (label === "BOM") expect(startsWithBom(onlyFile), "the BOM fixture lost its BOM").toBe(true);
      });
    });
  }

  test("a second run of the partial path is a no-op with no write", async () => {
    await withFixture(async (fx) => {
      const file = join(fx.a, "specs", "plan", `${MILESTONE}.md`);
      const input = [...FM_LF, ...BODY_LF].join("\n");
      writeFileSync(file, input);
      await stampShippedIn(file, LOCAL_VERSION);
      await stampShipPartial(file);
      const once = read(file);
      expect(once, "the first run wrote nothing").not.toBe(input);

      const past = new Date("2001-01-01T00:00:00Z");
      utimesSync(file, past, past);
      // The mtime probe can see a pinned value before it is scored.
      expect(statSync(file).mtimeMs).toBe(past.getTime());

      await stampShippedIn(file, LOCAL_VERSION);
      await stampShipPartial(file);
      expect(read(file)).toBe(once);
      expect(statSync(file).mtimeMs, "the second run rewrote the file").toBe(past.getTime());
    });
  });

  test("probe #63 reads the writer's value as the bare true: the no-plan row downgrades to a note", async () => {
    await withFixture(async (fx) => {
      writeFileSync(join(fx.a, "CHANGELOG.md"), CHANGELOG);
      const plan = writePlan(fx.a, "archive", MILESTONE, { spans: spansAtoB(fx), shippedIn: null });
      // B is located and holds no plan for the milestone — STE-588's no-plan trigger.
      await stampShippedIn(plan, LOCAL_VERSION);
      const before = await runPlanShipCoherenceProbe(fx.a);
      expect(
        before.violations.filter((v) => v.kind === "sibling_unshipped").length,
        describeReport(before),
      ).toBe(1);

      await stampShipPartial(plan);
      const after = await runPlanShipCoherenceProbe(fx.a);
      expect(after.violations, describeReport(after)).toEqual([]);
      expect(after.notes).toContain(`siblings awaiting release: ${MILESTONE} → ${B_NAME} (no plan)`);
    });
  });

  test("stampShippedIn's body is byte-identical to main's", () => {
    const re = /export async function stampShippedIn\([\s\S]*?\n\}\n/;
    const proc = spawnSync("git", ["show", "main:./adapters/_shared/src/plan_ship_stamp.ts"], {
      cwd: PLUGIN_ROOT,
      encoding: "utf-8",
    });
    expect(proc.status, proc.stderr).toBe(0);
    const onMain = re.exec(proc.stdout)?.[0];
    expect(onMain, "main's stampShippedIn was not found — the extractor is blind").toBeDefined();
    expect(re.exec(readLf(STAMP_MODULE))?.[0]).toBe(onMain);
  });

  test("step 7 of the skill writes ship_partial through stampShipPartial from plan_ship_stamp.ts", () => {
    const body = readLf(SKILL);
    const start = body.indexOf("### 7.");
    const end = body.indexOf("### 8.");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const step7 = body.slice(start, end);
    expect(step7).toContain("stampShippedIn");
    expect(step7).toContain("stampShipPartial");
    expect(step7).toContain("plan_ship_stamp.ts");
    expect(step7).toContain("--partial");
    expect(step7).toContain("ship_partial: true");
  });

  // The measure is the DEFINITION, not an occurrence count: STE-588's sibling
  // leg legitimately REUSES `STAMP_RE` in plan_ship_coherence.ts, so a use-site
  // count would red a correct tree. The checker reports two things, each as a
  // finding line: (1) the `const STAMP_RE = …;` definition is not exactly one
  // line on each side, or differs byte-for-byte from main's (its line number
  // may move); (2) a line the branch adds over main carries a stamp-shaped
  // regex literal (`/^v\d` or `/^v(\d`). "Added" is the multiset difference of
  // lines, so a moved-but-unchanged line is not an addition.
  const STAMP_DEF_RE = /^\s*(?:export\s+)?const\s+STAMP_RE\s*=.*;\s*$/;
  const STAMP_LITERAL_RE = /\/\^v\(?\\d/;

  const stampReGuard = (onMain: string, onBranch: string): string[] => {
    const findings: string[] = [];
    const mainLines = onMain.split("\n");
    const branchLines = onBranch.split("\n");
    const mainDefs = mainLines.filter((l) => STAMP_DEF_RE.test(l));
    const branchDefs = branchLines.filter((l) => STAMP_DEF_RE.test(l));
    if (mainDefs.length !== 1) findings.push(`main carries ${mainDefs.length} STAMP_RE definitions`);
    if (branchDefs.length !== 1) findings.push(`branch carries ${branchDefs.length} STAMP_RE definitions`);
    if (mainDefs.length === 1 && branchDefs.length === 1 && mainDefs[0] !== branchDefs[0]) {
      findings.push(`definition changed: ${JSON.stringify(mainDefs[0])} → ${JSON.stringify(branchDefs[0])}`);
    }
    const remaining = new Map<string, number>();
    for (const l of mainLines) remaining.set(l, (remaining.get(l) ?? 0) + 1);
    for (const l of branchLines) {
      const left = remaining.get(l) ?? 0;
      if (left > 0) {
        remaining.set(l, left - 1);
        continue;
      }
      if (STAMP_LITERAL_RE.test(l)) findings.push(`added stamp-shaped regex literal: ${JSON.stringify(l)}`);
    }
    return findings;
  };

  const showOnMain = (file: string): string => {
    const proc = spawnSync("git", ["show", `main:./adapters/_shared/src/${file}`], {
      cwd: PLUGIN_ROOT,
      encoding: "utf-8",
    });
    expect(proc.status, proc.stderr).toBe(0);
    return proc.stdout;
  };

  for (const file of ["plan_ship_coherence.ts", "resume_classifier.ts", "active_plan_ship_ready.ts"]) {
    test(`${file}: STAMP_RE's definition is byte-identical to main's and no stamp-shaped regex is added`, () => {
      expect(stampReGuard(showOnMain(file), read(join(SHARED_SRC, file)))).toEqual([]);
    });
  }

  // The AC's closing clause reaches BEYOND the three named files: no module
  // GAINS a second stamp-shaped regex literal. "Gains" is measured per module
  // against main: a module may carry its first (sibling_release.ts carries one
  // by Decision D), but none may grow past max(its count on main, 1).
  const stampLiteralCount = (src: string): number =>
    src.split("\n").filter((l) => STAMP_LITERAL_RE.test(l)).length;

  const mainStampLiteralCounts = (): Map<string, number> => {
    const proc = spawnSync(
      "git",
      ["grep", "-c", "-E", "/\\^v\\(?\\\\d", "main", "--", "adapters/_shared/src/*.ts"],
      { cwd: PLUGIN_ROOT, encoding: "utf-8" },
    );
    // git grep exits 0 with matches and 1 with none; anything else is a broken read.
    expect([0, 1], proc.stderr).toContain(proc.status);
    const counts = new Map<string, number>();
    for (const line of proc.stdout.split("\n").filter(Boolean)) {
      const m = /^main:(?:.*\/)?adapters\/_shared\/src\/([^/:]+\.ts):(\d+)$/.exec(line);
      if (m) counts.set(m[1]!, Number(m[2]));
    }
    return counts;
  };

  test("no shared module GAINS a second stamp-shaped regex literal over main, beyond the three named files", () => {
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    const onMain = mainStampLiteralCounts();
    // Non-vacuity: the main-side count sees main's three STAMP_RE definitions.
    for (const f of ["plan_ship_coherence.ts", "resume_classifier.ts", "active_plan_ship_ready.ts"]) {
      expect(onMain.get(f), `main-side stamp-literal count for ${f}`).toBe(1);
    }
    const files = readdirSync(SHARED_SRC).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    expect(files.length, "the sweep must see the shared modules").toBeGreaterThan(20);
    const grown = files
      .map((f) => ({ f, now: stampLiteralCount(read(join(SHARED_SRC, f))), was: onMain.get(f) ?? 0 }))
      .filter(({ now, was }) => now > Math.max(was, 1))
      .map(({ f, now, was }) => `${f}: ${was} on main -> ${now} now`);
    expect(grown, grown.join("\n")).toEqual([]);
    // Decision D's one copy is present and counted: exactly one in sibling_release.ts.
    expect(stampLiteralCount(read(join(SHARED_SRC, "sibling_release.ts")))).toBe(1);
  });

  test("the sweep's counter reports a module that gains a second stamp-shaped literal", () => {
    const one = "const A = /^v(\\d+\\.\\d+\\.\\d+)$/;\n";
    const two = `${one}const B = /^v\\d+\\.\\d+\\.\\d+$/;\n`;
    expect(stampLiteralCount(one)).toBe(1);
    expect(stampLiteralCount(two)).toBe(2);
    expect(stampLiteralCount(two) > Math.max(stampLiteralCount(one), 1), "two over a main of one is a gain").toBe(true);
  });

  describe("the STAMP_RE guard's controls — it reports what it exists to catch, and only that", () => {
    const DEF = "const STAMP_RE = /^v(\\d+\\.\\d+\\.\\d+)$/;";
    const MAIN = ["import x from 'y';", "", DEF, "", "export function f(s: string) {", "  return STAMP_RE.exec(s);", "}", ""].join(
      "\n",
    );

    test("the controls start from a clean baseline: main against itself reports nothing", () => {
      expect(stampReGuard(MAIN, MAIN)).toEqual([]);
    });

    test("an ALTERED definition is reported as a changed definition", () => {
      const altered = MAIN.replace(DEF, "const STAMP_RE = /^v(\\d+\\.\\d+\\.\\d+)(-rc)?$/;");
      expect(altered).not.toBe(MAIN);
      const findings = stampReGuard(MAIN, altered);
      expect(findings.some((f) => f.startsWith("definition changed:")), findings.join("\n")).toBe(true);
    });

    test("a SECOND /^v\\d…$/ literal is reported as an added stamp-shaped regex", () => {
      const second = MAIN.replace(DEF, `${DEF}\nconst OTHER_RE = /^v\\d+\\.\\d+\\.\\d+$/;`);
      const findings = stampReGuard(MAIN, second);
      expect(findings, findings.join("\n")).toEqual([
        `added stamp-shaped regex literal: ${JSON.stringify("const OTHER_RE = /^v\\d+\\.\\d+\\.\\d+$/;")}`,
      ]);
    });

    test("a duplicated definition is reported, even though its text is identical", () => {
      const dup = `${MAIN}\n${DEF}\n`;
      const findings = stampReGuard(MAIN, dup);
      expect(findings).toContain("branch carries 2 STAMP_RE definitions");
    });

    test("a REUSE of STAMP_RE and a moved-but-unchanged definition are not findings", () => {
      const reused = ["import x from 'y';", "", "// moved down", "", DEF, "export function f(s: string) {", "  return STAMP_RE.exec(s);", "}", "export const g = (s: string) => STAMP_RE.test(s.trim());", ""].join(
        "\n",
      );
      expect(reused.split("\n").filter((l) => l.includes("STAMP_RE")).length).toBe(3);
      expect(stampReGuard(MAIN, reused)).toEqual([]);
    });
  });
});

// ===========================================================================
// AC-STE-589.9 — not a deadlock
// ===========================================================================

describe("AC-STE-589.9 — two unstamped idle halves both pass; a busy sibling needs --partial", () => {
  test("mutual declaration, zero active FRs, neither stamped: neither refuses; then B goes busy", async () => {
    await withFixture(async (fx) => {
      const aPlan = buildSpan(fx);
      const bPlan = join(fx.b, "specs", "plan", `${MILESTONE}.md`);
      // Neither half is stamped.
      expect(read(aPlan)).toMatch(/^shipped_in: null$/m);
      expect(read(bPlan)).toMatch(/^shipped_in: null$/m);

      const fromA = await gateFrom(fx.a, aPlan);
      const fromB = await gateFrom(fx.b, bPlan);
      expect(fromA.refusal, fromA.refusal ?? "").toBeNull();
      expect(fromB.refusal, fromB.refusal ?? "").toBeNull();
      // Non-vacuity: each gate really read the other half.
      expect(fromA.footer).toEqual([`Spans: ${B_NAME}@pending`]);
      expect(fromB.footer).toEqual([`Spans: ${A_NAME}@pending`]);

      // The sibling goes busy.
      fx.activeFr(fx.b, FR_1, MILESTONE);
      expect((await gateFrom(fx.a, aPlan, false)).refusal).not.toBeNull();
      expect((await gateFrom(fx.a, aPlan, true)).refusal).toBeNull();
    });
  });
});

// ===========================================================================
// AC-STE-589.10 — a partial stamp is a real stamp
// ===========================================================================

describe("AC-STE-589.10 — the partial stamp reads as shipped everywhere the stamp is read", () => {
  /** A's archived plan spanning a busy, agreeing, unshipped B. */
  function buildShippedHalf(fx: SpanFixture, shippedIn: string | null): string {
    writeFileSync(join(fx.a, "CHANGELOG.md"), CHANGELOG);
    const plan = writePlan(fx.a, "archive", MILESTONE, { spans: spansAtoB(fx), shippedIn });
    fx.archivedFr(fx.a, FR_DONE_A, MILESTONE);
    writePlan(fx.b, "live", MILESTONE, { spans: spansBtoA(fx), shippedIn: null });
    fx.activeFr(fx.b, FR_1, MILESTONE);
    return plan;
  }

  test("zero corrupt_stamp rows from probe #63, and resume reads shipped with an empty chain", async () => {
    await withFixture(async (fx) => {
      const plan = buildShippedHalf(fx, null);
      await stampShippedIn(plan, LOCAL_VERSION);
      await stampShipPartial(plan);
      const body = read(plan);
      // The partial path really applied before it is scored.
      expect(body).toMatch(/^shipped_in: v2\.83\.0$/m);
      expect(body).toMatch(/^ship_partial: true$/m);

      const report = await runPlanShipCoherenceProbe(fx.a);
      expect(
        report.violations.filter((v) => v.kind === "corrupt_stamp"),
        describeReport(report),
      ).toEqual([]);

      const c = await classifyResume(fx.a, { scope: "milestone", milestone: MILESTONE });
      expect(c.state).toBe("shipped");
      expect(resumeChain(c)).toEqual([]);
    });
  });

  test("the control: a DECORATED stamp in the same tree is a corrupt stamp and not shipped", async () => {
    await withFixture(async (fx) => {
      buildShippedHalf(fx, `v${LOCAL_VERSION} (partial)`);
      const report = await runPlanShipCoherenceProbe(fx.a);
      expect(
        report.violations.filter((v) => v.kind === "corrupt_stamp").length,
        describeReport(report),
      ).toBe(1);
      const c = await classifyResume(fx.a, { scope: "milestone", milestone: MILESTONE });
      expect(c.state).not.toBe("shipped");
    });
  });
});

// ===========================================================================
// AC-STE-589.11 — the commit-msg hook accepts the footer
// ===========================================================================

describe("AC-STE-589.11 — templates/git-hooks/commit-msg.sh and the Spans: footer", () => {
  function runHook(fx: SpanFixture, message: string): { status: number | null; stderr: string } {
    const file = join(fx.a, "COMMIT_EDITMSG");
    writeFileSync(file, message);
    const proc = spawnSync("sh", [HOOK, file], { encoding: "utf-8" });
    return { status: proc.status, stderr: proc.stderr ?? "" };
  }

  test("a message whose footer carries Spans: glacy-app-be@pending exits 0", async () => {
    await withFixture(async (fx) => {
      const message = [
        `chore(release): v${LOCAL_VERSION}`,
        "",
        "Ship this half.",
        "",
        `Release: v${LOCAL_VERSION} "Fixture"`,
        `Spans: ${B_NAME}@pending`,
        `Refs: ${MILESTONE}`,
        "",
      ].join("\n");
      const run = runHook(fx, message);
      expect(run.status, run.stderr).toBe(0);
    });
  });

  test("a 73-character subject exits 1", async () => {
    await withFixture(async (fx) => {
      const prefix = "chore(release): ";
      const subject = `${prefix}${"x".repeat(73 - prefix.length)}`;
      expect(subject.length).toBe(73);
      const run = runHook(fx, `${subject}\n\nBody.\n\nSpans: ${B_NAME}@pending\n`);
      expect(run.status, run.stderr).toBe(1);
      expect(run.stderr).toContain("subject-too-long");
    });
  });

  test("the skill's own commit template, rendered, carries the Spans: footer and passes the hook", async () => {
    await withFixture(async (fx) => {
      const lines = readLf(SKILL).split("\n");
      const subject = lines.indexOf("chore(release): v<X.Y.Z>");
      expect(subject, "no commit template subject line").toBeGreaterThanOrEqual(0);
      const fenceEnd = lines.findIndex((l, i) => i > subject && l.startsWith("```"));
      const rendered = lines
        .slice(subject, fenceEnd)
        .join("\n")
        .replaceAll("<X.Y.Z>", LOCAL_VERSION)
        .replaceAll("<Codename>", "Fixture")
        .replaceAll("<one-line summary>", "Ship this half.")
        .replaceAll("<repo>@<version|pending>", `${B_NAME}@pending`)
        .replaceAll("M<N>", MILESTONE);
      expect(rendered).not.toContain("<");
      expect(rendered).toContain(`Spans: ${B_NAME}@pending`);
      const run = runHook(fx, `${rendered}\n`);
      expect(run.status, run.stderr).toBe(0);
    });
  });
});

// ===========================================================================
// AC-STE-589.12 — the reference docs
// ===========================================================================

describe("AC-STE-589.12 — docs/ship-milestone-reference.md and docs/layout-reference.md", () => {
  /** Every `## ` heading with its section text, in file order. */
  function sections(body: string): Array<{ heading: string; text: string }> {
    const lines = body.split("\n");
    const out: Array<{ heading: string; text: string }> = [];
    let fence = false;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.startsWith("```")) fence = !fence;
      if (!fence && lines[i]!.startsWith("## ")) out.push({ heading: lines[i]!, text: "" });
      else if (out.length > 0) out[out.length - 1]!.text += `${lines[i]!}\n`;
    }
    return out;
  }

  test("a refusal #4 decision matrix sits beside the refusal #1 matrix", () => {
    const all = sections(readLf(REFERENCE));
    const one = all.findIndex((s) => /^## Refusal #1\b/.test(s.heading));
    expect(one, "no `## Refusal #1` section").toBeGreaterThanOrEqual(0);
    const neighbours = [all[one - 1], all[one + 1]].filter((s) => s !== undefined);
    const four = neighbours.find((s) => /^## Refusal #4\b/.test(s!.heading));
    expect(four, `no \`## Refusal #4\` section beside refusal #1; neighbours: ${neighbours.map((s) => s!.heading).join(" | ")}`).toBeDefined();
    const tableRows = four!.text.split("\n").filter((l) => l.startsWith("|"));
    expect(tableRows.length, "the refusal #4 section holds no decision matrix").toBeGreaterThanOrEqual(3);
    expect(tableRows.join("\n")).toContain("--partial");
  });

  test("the refusal summary lists five refusal verdicts, one of them the sibling refusal", () => {
    const summary = sections(readLf(REFERENCE)).find((s) => /^## Refusal summary\b/.test(s.heading));
    expect(summary, "no `## Refusal summary` section").toBeDefined();
    expect(summary!.text).toMatch(/\bfive refusal verdicts\b/i);
    const items = summary!.text.split("\n").filter((l) => /^\d+\. /.test(l));
    expect(items.length, items.join("\n")).toBe(5);
    expect(items.some((l) => /sibling/i.test(l)), items.join("\n")).toBe(true);
  });

  test("the busy --partial row says its footer is measured: pending or the sibling's stamp", () => {
    const four = sections(readLf(REFERENCE)).find((s) => /^## Refusal #4\b/.test(s.heading));
    expect(four, "no `## Refusal #4` section").toBeDefined();
    const row = four!.text.split("\n").find((l) => l.startsWith("| Sibling busy, `--partial`"));
    expect(row, "no busy --partial row").toBeDefined();
    expect(row!).toContain("pending");
    expect(row!).toContain("@v<X.Y.Z>");
  });

  test("verdict 5 is spelled like the other four and names itself refusal #4", () => {
    const summary = sections(readLf(REFERENCE)).find((s) => /^## Refusal summary\b/.test(s.heading));
    const items = summary!.text.split("\n").filter((l) => /^\d+\. /.test(l));
    const five = items.find((l) => l.startsWith("5. "));
    expect(five, items.join("\n")).toBeDefined();
    expect(five!).not.toContain("/ship-milestone:");
    expect(five!).toMatch(/refusal #4/);
  });

  test("layout-reference.md documents ship_partial: in the voice of its --parked line", () => {
    const lines = readLf(LAYOUT).split("\n");
    // The voice being matched, so the pin cannot outlive its model.
    expect(lines.some((l) => /^- `--parked` additionally writes `ship_state: parked`/.test(l))).toBe(true);
    const partial = lines.find((l) => l.startsWith("- `--partial`"));
    expect(partial, "no `- `--partial`` bullet").toBeDefined();
    expect(partial!).toMatch(/\bwrites `ship_partial: true`/);
    expect(partial!).toContain("frontmatter");
  });
});

// ===========================================================================
// AC-STE-589.13 — the skill stays within its NFR-1 budget
// ===========================================================================

describe("AC-STE-589.13 — skills/ship-milestone/SKILL.md measures at most 358 split-lines", () => {
  test("split-line count ≤ 358", () => {
    expect(readLf(SKILL).split("\n").length).toBeLessThanOrEqual(358);
  });
});
