// M_79b1f6 / STE-590 — every offer of the release asks the sibling gate first.
//
// THE DEFECT, measured 2026-09-10 on this branch before the fix: a
// milestone-scope resume over an ARCHIVED, unstamped, unparked spanning plan
// whose sibling still holds an active FR orders `/implement`, `/ship-milestone`
// and `/pr`. The sibling wait reads only LIVE plans (`classifyActivePlans`), so
// the archived leg — the state the ship path actually runs in — never asks.
// The same fixture with the plan LIVE orders nothing (the previous milestone's
// suites pin that), which is what makes this a defect and not a bad fixture.
//
// Three prose surfaces offer the release on local state alone, and each must
// now run the ONE front door, `adapters/_shared/src/sibling_release.ts`, before
// offering: `/implement` Phase 5, the `/spec-archive` exit hint, and the
// no-argument `/ship-milestone` ship-debt offer.
//
// REGRESSION PINS (expected green before the fix): AC.2 (the previous
// milestone's live-plan suites), AC.7 (containment — the gate reads only its
// own plan) and AC.8 (the reachability pin).
//
// Every two-root tree is built on `tests/_span_fixture.ts` over REAL temp roots
// torn down in a `finally`. Its `planA`/`planB` write LIVE plans only, so the
// archived plan is written by a local writer of the same shape.

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { classifyActivePlans } from "../adapters/_shared/src/active_plan_ship_ready";
import {
  ORDERED_UNREACHABLE_PIN,
  runModuleReachabilityProbe,
} from "../adapters/_shared/src/module_reachability";
import { classifyResume, resumeChain } from "../adapters/_shared/src/resume_classifier";
import * as siblingRelease from "../adapters/_shared/src/sibling_release";
import { SpansReposError, readSpansReposDeclaration } from "../adapters/_shared/src/spans_repos";
import { type SpanFixture, makeSpanFixture } from "./_span_fixture";

// ===========================================================================
// Paths.
// ===========================================================================

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const RESUME_MODULE = join(PLUGIN_ROOT, "adapters", "_shared", "src", "resume_classifier.ts");
/** The front door, spelled exactly as every skill must name it. */
const FRONT_DOOR = "adapters/_shared/src/sibling_release.ts";
const skillPath = (name: string): string => join(PLUGIN_ROOT, "skills", name, "SKILL.md");
const IMPLEMENT_SKILL = skillPath("implement");
const ARCHIVE_SKILL = skillPath("spec-archive");
const SHIP_SKILL = skillPath("ship-milestone");

/** Text with CRLF folded, for prose assertions. */
const readLf = (p: string): string => readFileSync(p, "utf-8").replace(/\r\n/g, "\n");
const splitCount = (p: string): number => readFileSync(p, "utf-8").split("\n").length;

// ===========================================================================
// Vocabulary.
// ===========================================================================

const MILESTONE = "M_GF_80";
const OTHER = "M_GF_81";
const A_NAME = "glacy-app-fe";
const B_NAME = "glacy-app-be";
const A_FR = "STE-9300"; // root A's own work — archived, so the milestone is not "nothing built yet"
const B_FR = "STE-9301"; // root B's work — active (busy) or archived (clear)
const OTHER_FR = "STE-9302";

/** A flow list: the shared parser hands it back as a STRING, which refuses. */
const MALFORMED_SPANS_LINE = `spans_repos: [${A_NAME}, ${B_NAME}]`;

const skills = (chain: readonly { skill: string }[]): string[] => chain.map((s) => s.skill);

// ===========================================================================
// Tree builders.
// ===========================================================================

type Where = "live" | "archive";

/**
 * Write a plan for `token` under `root` — the shape `_span_fixture.ts` writes,
 * with the archive home added. `archive` writes `status: archived` and a
 * non-null `archived_at`. `shippedIn: null` writes the template sentinel; a
 * string is written verbatim. `spansRaw` writes the `spans_repos:` line verbatim.
 */
function writePlan(
  root: string,
  where: Where,
  token: string,
  opts: {
    spans?: Record<string, string>;
    spansRaw?: string;
    shippedIn?: string | null;
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
    opts.shippedIn === undefined || opts.shippedIn === null
      ? "shipped_in: null"
      : `shipped_in: ${opts.shippedIn}`,
  ];
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

const spansToB = (fx: SpanFixture): Record<string, string> => ({
  [A_NAME]: ".",
  [B_NAME]: relative(fx.a, fx.b),
});

/**
 * Root A: the milestone's plan ARCHIVED (unstamped unless `shippedIn` says
 * otherwise), spanning B, with one archived FR bound. Root B: `B_FR` bound to
 * the milestone, active when `busy`, archived otherwise. Returns A's plan file.
 */
function buildArchivedSpan(
  fx: SpanFixture,
  opts: { busy: boolean; shippedIn?: string | null; extra?: Record<string, string> },
): string {
  const plan = writePlan(fx.a, "archive", MILESTONE, {
    spans: spansToB(fx),
    shippedIn: opts.shippedIn ?? null,
    extra: opts.extra,
  });
  fx.archivedFr(fx.a, A_FR, MILESTONE);
  if (opts.busy) fx.activeFr(fx.b, B_FR, MILESTONE);
  else fx.archivedFr(fx.b, B_FR, MILESTONE);
  return plan;
}

async function withFixture<T>(body: (fx: SpanFixture) => Promise<T>): Promise<T> {
  const fx = makeSpanFixture(MILESTONE);
  try {
    return await body(fx);
  } finally {
    fx.cleanup();
  }
}

const milestoneScope = (root: string) =>
  classifyResume(root, { scope: "milestone", milestone: MILESTONE });

// ===========================================================================
// The gate, reached through the namespace so a missing export fails by name.
// ===========================================================================

interface GateResult {
  readonly refusal: string | null;
  readonly footer: readonly string[];
  readonly unchecked: readonly string[];
}

function siblingShipGate(input: {
  projectRoot: string;
  planBody: string;
  milestone: string;
  partial: boolean;
}): Promise<GateResult> {
  const fn = (siblingRelease as Record<string, unknown>).siblingShipGate;
  if (typeof fn !== "function") throw new Error(`${FRONT_DOOR} exports no siblingShipGate`);
  return (fn as (i: typeof input) => Promise<GateResult>)(input);
}

interface DoorRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Spawn the front door exactly as the skills order it: by path, from the plugin root. */
function frontDoor(projectRoot: string, planFile: string, milestone: string): DoorRun {
  const proc = spawnSync("bun", ["run", FRONT_DOOR, projectRoot, planFile, milestone], {
    cwd: PLUGIN_ROOT,
    encoding: "utf-8",
  });
  return { status: proc.status, stdout: proc.stdout ?? "", stderr: proc.stderr ?? "" };
}

const describeDoor = (d: DoorRun): string =>
  `exit=${d.status}\n--- stdout ---\n${d.stdout}\n--- stderr ---\n${d.stderr}`;

// ===========================================================================
// Suite and git helpers for the regression pins.
// ===========================================================================

/** Run one suite in a child `bun test`; green means exit 0 AND something passed. */
function expectSuiteGreen(suite: string): void {
  const proc = spawnSync("bun", ["test", suite], { cwd: PLUGIN_ROOT, encoding: "utf-8" });
  const out = `${proc.stdout ?? ""}${proc.stderr ?? ""}`;
  expect(proc.status, `${suite} is not green:\n${out.slice(-4000)}`).toBe(0);
  // Non-vacuity: a run that collected nothing exits 0 too.
  expect(out, `${suite} collected nothing`).toMatch(/\b[1-9]\d* pass\b/);
  expect(out).toMatch(/\b0 fail\b/);
}

/** The suite's working-tree bytes equal `ref`'s committed bytes. */
function expectUnedited(suite: string, ref: "main" | "HEAD"): void {
  const proc = spawnSync("git", ["diff", "--quiet", ref, "--", suite], {
    cwd: PLUGIN_ROOT,
    encoding: "utf-8",
  });
  expect(proc.status, `${suite} differs from ${ref}${proc.stderr ? `: ${proc.stderr}` : ""}`).toBe(
    0,
  );
  // Non-vacuity: the pathspec names a tracked file on `ref`.
  const tracked = spawnSync("git", ["cat-file", "-e", `${ref}:./${suite}`], {
    cwd: PLUGIN_ROOT,
    encoding: "utf-8",
  });
  expect(tracked.status, `${suite} is not tracked on ${ref}`).toBe(0);
}

// ===========================================================================
// Prose passage extractors — located by heading or marker, never by line number.
// ===========================================================================

/** `## Phase 5: Milestone close prompt` up to the next `## ` heading. */
function phase5Section(): string {
  const lines = readLf(IMPLEMENT_SKILL).split("\n");
  const start = lines.indexOf("## Phase 5: Milestone close prompt");
  expect(start, "no `## Phase 5: Milestone close prompt` heading").toBeGreaterThanOrEqual(0);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i]!.startsWith("## ")) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

/** The single `**Exit hints**` line of the spec-archive skill. */
function exitHintsLine(): string {
  const hits = readLf(ARCHIVE_SKILL)
    .split("\n")
    .filter((l) => l.startsWith("**Exit hints**"));
  expect(hits.length, "expected exactly one `**Exit hints**` line").toBe(1);
  return hits[0]!;
}

/** `### Ship-debt offer` up to the next heading of any level. */
function shipDebtSection(): string {
  const lines = readLf(SHIP_SKILL).split("\n");
  const start = lines.indexOf("### Ship-debt offer");
  expect(start, "no `### Ship-debt offer` heading").toBeGreaterThanOrEqual(0);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,6} /.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

/** Backtick code spans on one line. */
const codeSpans = (line: string): string[] => [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);

/** Strip `//` line comments and block comments, keeping string contents. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
}

/** A top-level function's source, from its signature to its closing `}` line. */
function functionSource(src: string, signature: string): string {
  const start = src.indexOf(signature);
  expect(start, `no \`${signature}\` in the module`).toBeGreaterThanOrEqual(0);
  const end = src.indexOf("\n}\n", start);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end + 3);
}

const occurrences = (haystack: string, re: RegExp): number =>
  [...haystack.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`))]
    .length;

// ===========================================================================
// AC-STE-590.1 — the archived leg waits for the sibling too
// ===========================================================================

describe("AC-STE-590.1 — a milestone-scope resume over an ARCHIVED unstamped spanning plan waits for a busy sibling", () => {
  test("archived + unstamped + unparked, sibling busy: awaitingSiblings names the sibling and resumeChain is []", async () => {
    await withFixture(async (fx) => {
      buildArchivedSpan(fx, { busy: true });
      const c = await milestoneScope(fx.a);
      // The fixture is the state named: the plan resolved from the archive home.
      expect(c.planStatus).toBe("archived");
      expect(c.shippedIn).toBeNull();
      const awaiting = c.awaitingSiblings ?? [];
      expect(awaiting.length, `awaitingSiblings: ${JSON.stringify(awaiting)}`).toBeGreaterThan(0);
      expect(awaiting.some((e) => e.startsWith(`${MILESTONE} `) && e.includes(B_NAME))).toBe(true);
      const chain = resumeChain(c);
      expect(skills(chain), `chain ordered: ${skills(chain).join(", ")}`).toEqual([]);
    });
  });

  test("its archived-CLEAR twin (the sibling's FR archived) still carries /ship-milestone", async () => {
    await withFixture(async (fx) => {
      buildArchivedSpan(fx, { busy: false });
      const c = await milestoneScope(fx.a);
      expect(c.planStatus).toBe("archived");
      expect(c.awaitingSiblings ?? []).toEqual([]);
      expect(skills(resumeChain(c))).toContain("/ship-milestone");
    });
  });

  test("control: a STAMPED archived plan over the same busy sibling still reads shipped with an empty chain", async () => {
    await withFixture(async (fx) => {
      buildArchivedSpan(fx, { busy: true, shippedIn: "v1.2.3" });
      const c = await milestoneScope(fx.a);
      expect(c.state).toBe("shipped");
      expect(resumeChain(c)).toEqual([]);
    });
  });

  test("control: a PARKED archived plan over the same busy sibling still reads parked with an empty chain", async () => {
    await withFixture(async (fx) => {
      buildArchivedSpan(fx, { busy: true, extra: { ship_state: "parked" } });
      const c = await milestoneScope(fx.a);
      expect(c.state).toBe("parked");
      expect(resumeChain(c)).toEqual([]);
    });
  });

  test("source: classifyMilestoneResume reads spanningSiblingState — the shared predicate — and no second count", () => {
    const body = stripComments(
      functionSource(readLf(RESUME_MODULE), "async function classifyMilestoneResume("),
    );
    expect(body, "the milestone leg never calls spanningSiblingState").toMatch(
      /\bspanningSiblingState\s*\(/,
    );
    // No second read of the shared classification, no private sibling walk.
    expect(occurrences(body, /\bclassifyActivePlans\s*\(/)).toBe(1);
    expect(occurrences(body, /\bmilestoneFrBinding\s*\(/)).toBe(1);
    expect(body).not.toMatch(/\bresolveSpansRepos\b/);
    expect(body).not.toMatch(/\breadSiblingPlan\b/);
    expect(body).not.toMatch(/\breaddir(?:Sync)?\b/);
  });
});

// ===========================================================================
// AC-STE-590.2 — the live-plan answers are unchanged (regression pin)
// ===========================================================================

describe("AC-STE-590.2 — the previous milestone's live-plan busy/clear suites stay green and unedited", () => {
  const suites = [
    "tests/m_8f07e0-ste-584-awaiting-siblings.test.ts",
    "tests/m_8f07e0-ste-584-fr-scope-waits.test.ts",
  ];
  for (const suite of suites) {
    test(`${suite} is unedited against main`, () => {
      expectUnedited(suite, "main");
    });
    test(`${suite} is green`, () => {
      expectSuiteGreen(suite);
    }, 180_000);
  }
});

// ===========================================================================
// AC-STE-590.3 — /implement Phase 5 asks the gate before its prompt
// ===========================================================================

describe("AC-STE-590.3 — skills/implement/SKILL.md Phase 5 runs the front door before the prompt", () => {
  test("Phase 5 runs the front door by its path", () => {
    const section = phase5Section();
    expect(section).toContain(FRONT_DOOR);
    expect(section).toMatch(/bun run [^\n]*adapters\/_shared\/src\/sibling_release\.ts/);
  });

  test("the front door is ordered BEFORE the close prompt", () => {
    const section = phase5Section();
    const door = section.indexOf(FRONT_DOOR);
    const prompt = section.indexOf("All FRs in M<N> shipped.");
    expect(prompt, "the close prompt is gone from Phase 5").toBeGreaterThan(0);
    expect(door, "Phase 5 never names the front door").toBeGreaterThan(0);
    expect(door).toBeLessThan(prompt);
  });

  test("a refusal is printed in place of the prompt", () => {
    const section = phase5Section();
    expect(section).toMatch(
      /refus[\s\S]{0,200}\b(?:in place of|instead of)\b[\s\S]{0,60}\bprompt\b|\b(?:in place of|instead of)\b[\s\S]{0,60}\bprompt\b[\s\S]{0,200}refus/i,
    );
  });

  test("the file measures exactly 358 split-lines", () => {
    expect(splitCount(IMPLEMENT_SKILL)).toBe(358);
  });

  test("tests/implement-phase5-milestone-close.test.ts is unedited against main", () => {
    expectUnedited("tests/implement-phase5-milestone-close.test.ts", "main");
  });

  test("tests/implement-phase5-milestone-close.test.ts is green", () => {
    expectSuiteGreen("tests/implement-phase5-milestone-close.test.ts");
  }, 180_000);
});

// ===========================================================================
// AC-STE-590.4 — /spec-archive's third exit hint
// ===========================================================================

describe("AC-STE-590.4 — skills/spec-archive/SKILL.md gains a refused-spanning exit hint", () => {
  test("the Exit hints line carries a third hint naming the waiting sibling and --partial", () => {
    const line = exitHintsLine();
    const spans = codeSpans(line);
    const partialHints = spans.filter((s) => s.includes("--partial"));
    expect(partialHints.length, `code spans: ${JSON.stringify(spans)}`).toBeGreaterThanOrEqual(1);
    // Distinct from the two shipped hints.
    for (const hint of partialHints) {
      expect(hint).not.toBe("Archived. Next: /ship-milestone M<N>");
      expect(hint).not.toBe("Archived (parked). Unpark by shipping: /ship-milestone M<N>");
    }
    expect(line, "the third hint does not name the waiting sibling").toMatch(/\bsibling\b/i);
    expect(line, "the third hint is not tied to a gate refusal").toMatch(/refus/i);
  });

  test("the default hint occurs exactly once in the file", () => {
    expect(occurrences(readLf(ARCHIVE_SKILL), /Archived\. Next: \/ship-milestone M<N>/)).toBe(1);
  });

  test("the default and parked hints sit on the Exit hints line byte-for-byte", () => {
    const line = exitHintsLine();
    expect(line).toContain("`Archived. Next: /ship-milestone M<N>`");
    expect(line).toContain("`Archived (parked). Unpark by shipping: /ship-milestone M<N>`");
    expect(readLf(ARCHIVE_SKILL)).toContain(
      "Archived (parked). Unpark by shipping: /ship-milestone M<N>",
    );
  });

  test("tests/m143-ste-551-continuation-offers.test.ts is unedited against main", () => {
    expectUnedited("tests/m143-ste-551-continuation-offers.test.ts", "main");
  });

  test("tests/m143-ste-551-continuation-offers.test.ts is green", () => {
    expectSuiteGreen("tests/m143-ste-551-continuation-offers.test.ts");
  }, 180_000);
});

// ===========================================================================
// AC-STE-590.5 — the no-argument ship-debt offer never offers a refused candidate
// ===========================================================================

describe("AC-STE-590.5 — skills/ship-milestone/SKILL.md's ship-debt offer asks the gate", () => {
  test("the Ship-debt offer names the front door by its path", () => {
    expect(shipDebtSection()).toContain(FRONT_DOOR);
  });

  test("a candidate the gate refuses is not offered", () => {
    const lines = shipDebtSection().split("\n");
    const hit = lines.find(
      (l) => /refus/i.test(l) && /\b(?:not|never)\b.{0,40}\boffer(?:ed)?\b|\bdoes not offer\b/i.test(l),
    );
    expect(hit, "no line says a refused candidate is not offered").toBeDefined();
  });

  test("held candidates are named on ONE held line, so the omission is never silent", () => {
    const section = shipDebtSection();
    expect(section, "the offer never names a held line").toMatch(/\bheld\b/i);
    expect(section, "the held candidates are not said to share one line").toMatch(
      /\b(?:one|single)\b.{0,80}\bline\b/i,
    );
  });

  test("the file stays at most 358 split-lines", () => {
    expect(splitCount(SHIP_SKILL)).toBeLessThanOrEqual(358);
  });

  for (const suite of [
    "tests/ship-milestone-shape.test.ts",
    "tests/m_79b1f6-ste-589-sibling-ship-gate.test.ts",
  ]) {
    test(`${suite} is unedited against HEAD`, () => {
      expectUnedited(suite, "HEAD");
    });
    test(`${suite} is green`, () => {
      expectSuiteGreen(suite);
    }, 300_000);
  }
});

// ===========================================================================
// AC-STE-590.6 — one front door, named alike, predicate never restated
// ===========================================================================

describe("AC-STE-590.6 — the three passages name the same front door and restate no predicate", () => {
  const passages: Array<[string, () => string]> = [
    ["implement Phase 5 section", phase5Section],
    ["spec-archive Exit hints line", exitHintsLine],
    ["ship-milestone Ship-debt offer section", shipDebtSection],
  ];
  for (const [label, passage] of passages) {
    test(`${label} names ${FRONT_DOOR}`, () => {
      expect(passage()).toContain(FRONT_DOOR);
    });
    test(`${label} does not restate the predicate in prose`, () => {
      expect(passage(), `${label} spells out the active-FR predicate`).not.toMatch(
        /\bactive FRs?\b/i,
      );
    });
  }
});

// ===========================================================================
// AC-STE-590.7 — containment: the gate reads only its own plan (regression pin)
// ===========================================================================

describe("AC-STE-590.7 — a malformed spans_repos: on plan X leaves the verdict on plan Y unchanged", () => {
  /** Y: A's live plan spanning B, B's FR for Y `busy` or archived. Returns Y's file. */
  function buildY(fx: SpanFixture, busy: boolean): string {
    const y = writePlan(fx.a, "live", MILESTONE, { spans: spansToB(fx) });
    fx.archivedFr(fx.a, A_FR, MILESTONE);
    if (busy) fx.activeFr(fx.b, B_FR, MILESTONE);
    else fx.archivedFr(fx.b, B_FR, MILESTONE);
    return y;
  }

  /** X: a live, otherwise ship-ready plan in the SAME root with a malformed declaration. */
  function addMalformedX(fx: SpanFixture): string {
    const x = writePlan(fx.a, "live", OTHER, { spansRaw: MALFORMED_SPANS_LINE });
    fx.archivedFr(fx.a, OTHER_FR, OTHER);
    return x;
  }

  const gateOn = (fx: SpanFixture, planFile: string): Promise<GateResult> =>
    siblingShipGate({
      projectRoot: fx.a,
      planBody: readFileSync(planFile, "utf-8"),
      milestone: MILESTONE,
      partial: false,
    });

  for (const busy of [false, true]) {
    test(`sibling ${busy ? "busy" : "clear"}: siblingShipGate on Y is identical with and without X`, async () => {
      await withFixture(async (fx) => {
        const y = buildY(fx, busy);
        const alone = await gateOn(fx, y);
        // Non-vacuity: Y alone gives the verdict the corner names.
        expect(alone.refusal !== null, alone.refusal ?? "(passed)").toBe(busy);

        const x = addMalformedX(fx);
        // X really is malformed, and really is live in the shared classification.
        expect(() => readSpansReposDeclaration(readFileSync(x, "utf-8"))).toThrow(SpansReposError);
        await expect(classifyActivePlans(fx.a)).rejects.toBeInstanceOf(SpansReposError);

        expect(await gateOn(fx, y)).toEqual(alone);
      });
    });
  }

  test("front door on Y's plan file exits 0 beside the malformed X, printing Y's footer", async () => {
    await withFixture(async (fx) => {
      const y = buildY(fx, false);
      addMalformedX(fx);
      const door = frontDoor(fx.a, y, MILESTONE);
      expect(door.status, describeDoor(door)).toBe(0);
      expect(door.stdout.split("\n").filter((l) => l.trim() !== "")).toEqual([
        `Spans: ${B_NAME}@pending`,
      ]);
    });
  }, 30_000);
});

// ===========================================================================
// AC-STE-590.8 — the reachability pin holds (regression pin)
// ===========================================================================

describe("AC-STE-590.8 — module reachability holds its pin", () => {
  test("orderedUnreachable === ORDERED_UNREACHABLE_PIN and ok is true", async () => {
    const report = await runModuleReachabilityProbe(REPO_ROOT);
    expect(report.orderedUnreachable).toBe(ORDERED_UNREACHABLE_PIN);
    expect(report.ok).toBe(true);
  }, 60_000);
});

// ===========================================================================
// Stage C hardening (round 1) — every passage names the plan it gates, reads a
// refusal for what it says, and the reference docs describe the gate where it
// runs. Each check was dry-run FALSE against the pre-fix tree (0 of 11 true).
// ===========================================================================

describe("Stage C hardening — the gate is described where it runs, and read for what it says", () => {
  /** From the exact heading line up to the next line matching `stop`. */
  const sectionOf = (rel: string, heading: string, stop: RegExp): string => {
    const lines = readLf(join(PLUGIN_ROOT, rel)).split("\n");
    const start = lines.indexOf(heading);
    expect(start, `no \`${heading}\` in ${rel}`).toBeGreaterThanOrEqual(0);
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (stop.test(lines[i]!)) {
        end = i;
        break;
      }
    }
    return lines.slice(start, end).join("\n");
  };
  const refPhase5 = (): string =>
    sectionOf("docs/implement-reference.md", "## Phase 5 — Milestone close prompt", /^## /);
  const refCloseChain = (): string =>
    sectionOf(
      "docs/ship-milestone-reference.md",
      "## Interaction with `/implement M<N>` close-prompt chain",
      /^## /,
    );
  const archiveDrivenLine = (): string => {
    const hits = readLf(ARCHIVE_SKILL)
      .split("\n")
      .filter((l) => l.startsWith("**Driven runs.**"));
    expect(hits.length, "expected exactly one `**Driven runs.**` line in spec-archive").toBe(1);
    return hits[0]!;
  };
  const ARCHIVED_PLAN = "specs/plan/archive/M<N>.md";

  test("docs/implement-reference.md § Phase 5 orders the front door as a condition, ahead of the TTY check", () => {
    const s = refPhase5();
    expect(s).toContain(FRONT_DOOR);
    expect(s.indexOf("**TTY.**"), "the TTY condition is gone").toBeGreaterThan(0);
    expect(s.indexOf(FRONT_DOOR)).toBeLessThan(s.indexOf("**TTY.**"));
  });

  test("docs/implement-reference.md § Phase 5 no longer says 'all three', and its skip table carries a refusal row", () => {
    const s = refPhase5();
    expect(s).not.toMatch(/If all three pass/);
    expect(s).toMatch(/^\|[^\n]*refus[^\n]*\|/im);
  });

  test("docs/ship-milestone-reference.md's close-prompt section names the gate and its refusal", () => {
    const s = refCloseChain();
    expect(s).toContain(FRONT_DOOR);
    expect(s).toMatch(/refus/i);
  });

  test("the exit hints name the archived plan the gate reads", () => {
    expect(exitHintsLine()).toContain(ARCHIVED_PLAN);
  });

  // PRESENCE PINS, not behaviour pins. The next three catch the AC.4 clauses being
  // DELETED; they cannot catch the model rendering the exit line wrongly, because
  // no fixture drives /spec-archive over two roots and captures its closing line
  // (a recorded follow-up). The executable half the "as it is" rule depends on —
  // the front door's refusals separating cleanly — is pinned by behaviour in the
  // "AC-STE-590.4 behaviour" block at the end of this file.
  test("the exit hints print any other refusal as it is — only a waiting sibling reads as one", () => {
    expect(exitHintsLine()).toMatch(/refus[^.]{0,120}\b(?:as[- ]is|verbatim)\b/i);
  });

  test("a parked run keeps the parked hint", () => {
    expect(exitHintsLine()).toMatch(
      /\bparked\b[^.]{0,80}\bkeeps?\b|\bkeeps?\b[^.]{0,80}\bparked hint\b/i,
    );
  });

  test("spec-archive's driven-run paragraph says what becomes of the sibling-wait variant", () => {
    const line = archiveDrivenLine();
    expect(line).toMatch(/\bsibling\b/i);
    // The shipped clause the paragraph must keep.
    expect(line).toContain("Omit this offer when the invocation body carries the driven-run marker");
  });

  test("the ship-debt offer runs the gate on each candidate's archived plan", () => {
    expect(shipDebtSection()).toContain(ARCHIVED_PLAN);
  });

  test("Phase 5's front door names the plan it gates", () => {
    const s = phase5Section();
    const i = s.indexOf(FRONT_DOOR);
    expect(i, "Phase 5 never names the front door").toBeGreaterThan(0);
    expect(s.slice(i, i + 300)).toMatch(/specs\/plan\//);
  });

  test("Phase 5's gate runs ahead of the non-TTY hint too", () => {
    expect(phase5Section()).toMatch(
      /\b(?:before|ahead of)\b[^.]{0,80}\bnon-TTY\b|\bnon-TTY hint\b/i,
    );
  });
});

// ===========================================================================
// AC-STE-590.4, by behaviour — the executable half of "any other refusal is
// printed as it is". The exit hint may carry the sibling-wait wording only for a
// refusal that names a sibling still holding work, so that rule is implementable
// only if the front door's REAL refusals separate cleanly. Every refusal shape the
// door emits is spawned here and graded on its verdict line. The model's rendering
// of the exit line is NOT pinned — no fixture drives /spec-archive over two roots.
// ===========================================================================

describe("AC-STE-590.4 behaviour — only a busy sibling's refusal carries the sibling-wait verdict", () => {
  const SIBLING_WAIT = /^\/ship-milestone: \S+ spans a sibling that still holds active work — /;

  /** The verdict line of a refused run, after checking it is a whole house refusal. */
  const verdictOf = (d: DoorRun): string => {
    expect(d.status, describeDoor(d)).toBe(1);
    expect(d.stdout, describeDoor(d)).toBe("");
    const lines = d.stderr.replace(/\n+$/, "").split("\n");
    expect(lines.length, describeDoor(d)).toBe(3);
    expect(lines[0]!, describeDoor(d)).toMatch(/^\/ship-milestone: /);
    expect(lines[1]!, describeDoor(d)).toMatch(/^Remedy: /);
    expect(lines[2]!, describeDoor(d)).toMatch(/^Context: .*skill=ship-milestone$/);
    return lines[0]!;
  };

  /** Every refusal shape the front door emits, each from a real fixture. */
  async function refusalVerdicts(): Promise<Record<string, string>> {
    return withFixture(async (fx) => {
      const busyPlan = writePlan(fx.a, "live", MILESTONE, { spans: spansToB(fx) });
      fx.activeFr(fx.b, B_FR, MILESTONE);
      const malformedPlan = writePlan(fx.a, "live", OTHER, { spansRaw: MALFORMED_SPANS_LINE });
      const missingPlan = join(fx.a, "specs", "plan", "archive", "M_NOPE.md");
      const argv = spawnSync("bun", ["run", FRONT_DOOR, fx.a], {
        cwd: PLUGIN_ROOT,
        encoding: "utf-8",
      });
      return {
        busy: verdictOf(frontDoor(fx.a, busyPlan, MILESTONE)),
        malformed: verdictOf(frontDoor(fx.a, malformedPlan, OTHER)),
        unreadable: verdictOf(frontDoor(fx.a, missingPlan, MILESTONE)),
        argv: verdictOf({ status: argv.status, stdout: argv.stdout ?? "", stderr: argv.stderr ?? "" }),
      };
    });
  }

  test("the busy sibling's verdict, and only it, carries the sibling-wait wording and names the sibling", async () => {
    const v = await refusalVerdicts();
    expect(v.busy).toMatch(SIBLING_WAIT);
    expect(v.busy).toContain(B_NAME);
    for (const other of ["malformed", "unreadable", "argv"] as const) {
      expect(v[other], `${other}: ${v[other]}`).not.toMatch(SIBLING_WAIT);
    }
  }, 60_000);

  test("every other refusal names its own cause, so printing it as it is tells the operator what broke", async () => {
    const v = await refusalVerdicts();
    expect(v.malformed).toMatch(/\bmalformed\b/);
    expect(v.unreadable).toContain("M_NOPE.md");
    expect(v.argv).toMatch(/\bneeds a project root\b/);
  }, 60_000);

  test("control: a non-sibling refusal given the sibling-wait verdict is flagged, so the check can fail", async () => {
    const v = await refusalVerdicts();
    const mutant = v.malformed.replace(
      /^\/ship-milestone: .*$/,
      `/ship-milestone: ${OTHER} spans a sibling that still holds active work — ${B_NAME}: 1 active FRs (${B_FR})`,
    );
    expect(mutant).not.toBe(v.malformed);
    expect(mutant).toMatch(SIBLING_WAIT);
  }, 60_000);
});
