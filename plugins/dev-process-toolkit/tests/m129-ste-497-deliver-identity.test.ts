// M129 STE-497 — `/deliver` refuses a milestone identity it cannot deliver,
// instead of brainstorming it.
//
// WHAT IS BROKEN, measured on this tree at authoring time (2026-08-17, v2.67.1):
//
//   * `skills/deliver/SKILL.md:4` — `argument-hint: '[feature request or idea]'`.
//     A milestone identity is a well-formed "idea", so `/deliver M129` is
//     accepted and walks straight into Phase 1's Socratic design questions
//     about work whose plan is already on disk.
//   * `ls adapters/_shared/src/deliver_argument*` → no matches. The module this
//     file specifies does not exist; nothing anywhere classifies `/deliver`'s
//     argument at all.
//   * `grep -ic "design phase\|new work\|no plan file" skills/deliver/SKILL.md
//     docs/deliver-reference.md` → ZERO hits for each, on both surfaces. There
//     is no vocabulary for "this argument names something that already exists"
//     and none for "you meant to start new work".
//
// TEST STRATEGY, and why no half of it is a tautology.
//
//   * BEHAVIOUR FIRST, PROSE SECOND. This repo has a documented history of
//     prose-grep ACs reading green while the behaviour is absent — STE-492, in
//     THIS milestone, is exactly that defect. So the argument classifier, the
//     FR→milestone resolution, the plan probe, the refusal and the non-tty gate
//     all live in `adapters/_shared/src/deliver_argument.ts` and are exercised
//     as CODE. Every prose pin below is the second half of a pair whose first
//     half is behavioural, and every prose pin is anchored on a token that
//     returns ZERO hits on both `/deliver` surfaces today (`design phase`,
//     `new work`) — so none of them can be passing already.
//   * AC.2 IS THE ANTI-PRIVATE-COPY AC AND IT IS PINNED HARD. The milestone
//     grammar is a UNION, not `M\d+`: the three mint paths emit `M<N>` (Linear),
//     `M_<epic-key>` (Jira) and `M_<short-ULID>` (tracker-less). All three are
//     asserted recognized, and the two opaque ones are DERIVED IN THE TEST by
//     calling the shipped mint functions rather than being retyped, so a
//     hand-rolled `M\d+` fails on the very forms it would silently misroute.
//     The module source is additionally grepped for a private numeric pattern.
//   * AC.3 IS MUTATION-VERIFIED ON ITS SECOND HALF. "Refuses" and "never falls
//     through to the design phase" are two claims, and a refusal that still
//     entered design would pass a naive "did it throw?" assertion. So the design
//     phase is a real observable: `resolveDeliverArgument` calls
//     `phases.enterDesign(...)` for a feature request, and the refusal legs pass
//     a sink that RECORDS (asserted empty) and then a sink that THROWS if
//     touched at all (its distinctive error would replace the refusal and fail
//     the shape assertion).
//   * ISOLATION EVERYWHERE. "An identity is refused" is satisfied vacuously by a
//     resolver that refuses every identity, so an identity WITH a plan file on
//     disk — `M129` against the real `specs/plan/` tree — is asserted to
//     genuinely resolve, carrying its located plan path and entering no design
//     phase. "A feature request enters design" is likewise asserted positively.
//   * AC.6 IS THE BACKWARD-COMPATIBILITY SPINE, AND IT IS NOT A GREP. Real
//     feature-request prose — including prose that MENTIONS a milestone token
//     mid-sentence — must classify as a feature request, enter the design phase
//     exactly once with the operator's own words, consult no probe, and never
//     throw. Recognition is anchored on the whole argument, and that is asserted
//     by the mid-sentence corpus rather than assumed.
//   * AC.7 IS TESTED ON THE CASE THAT WOULD OTHERWISE SUCCEED. Under non-tty
//     stdin the resolver must refuse EVERY form — including a milestone identity
//     whose plan exists and an ordinary feature request — with the canonical
//     marker IMPORTED from `requires_input.ts`, never retyped. The probe and the
//     design sink both explode if consulted, which is how "FIRST ACTION" is
//     asserted rather than assumed.
//
// DELIBERATE OMISSIONS.
//   * NO aggregate `/gate-check` probe-count assertion. This FR registers NO
//     probe; the count is 79 in this milestone and a count pin here would be
//     someone else's pin, reddening on their schedule rather than on this FR's
//     behaviour.
//   * NO new skill and NO new agent. The tripwires pin 27 / 8 so a "fix" that
//     adds a `/deliver-resume` skill fails here rather than in review.
//   * NO assertion about what `/deliver` DOES with a milestone whose plan
//     exists beyond "it resolves and does not brainstorm". Resuming it is a
//     separate FR by the reporter's own framing; this file pins the refusal and
//     the recognition, not a resume capability.
//
// HARD BUDGETS, measured at authoring time:
//   * `skills/` tree: 246 / 246 STE-N tokens — ZERO headroom. New `/deliver`
//     prose must cite by mechanism, never by ticket id — which is why not one
//     prose pin below demands a ticket id, and why the prose pins prefer
//     `docs/deliver-reference.md`.
//   * `skills/deliver/SKILL.md`: 119 lines of a 358 cap.
// This file lives under `tests/`, which carries neither budget.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

import { parseFrontmatter } from "../adapters/_shared/src/frontmatter";
import {
  milestoneIdFromEpicKey,
  milestoneIdFromUlid,
} from "../adapters/_shared/src/milestone_token";
import { REQUIRES_INPUT_REFUSED_MARKER } from "../adapters/_shared/src/requires_input";

// ===========================================================================
// Paths.
// ===========================================================================

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const SKILLS_DIR = join(PLUGIN_ROOT, "skills");
const AGENTS_DIR = join(PLUGIN_ROOT, "agents");
const DOCS_DIR = join(PLUGIN_ROOT, "docs");
const SHARED_SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src");

const read = (p: string): string => readFileSync(p, "utf-8");
const skillPath = (name: string): string => join(SKILLS_DIR, name, "SKILL.md");

const DELIVER_SKILL_FILE = skillPath("deliver");
const DELIVER_SKILL = (): string => read(DELIVER_SKILL_FILE);
const DELIVER_REFERENCE_FILE = join(DOCS_DIR, "deliver-reference.md");
const DELIVER_REFERENCE = (): string => read(DELIVER_REFERENCE_FILE);
/** Both `/deliver` surfaces as one body — either may host a given clause. */
const DELIVER_SURFACES = (): string =>
  `${DELIVER_SKILL()}\n\n${DELIVER_REFERENCE()}`;

/**
 * The FR under test, resolved with the ARCHIVE FALLBACK. `/implement` Phase 4
 * `git mv`s the FR into `specs/frs/archive/` at milestone close, and a
 * meta-test that only knows the active path goes red at the archive commit —
 * the recurring failure recorded in the M100/M126 notes.
 */
function frPath(): string {
  const active = join(REPO_ROOT, "specs", "frs", "STE-497.md");
  if (existsSync(active)) return active;
  const archived = join(REPO_ROOT, "specs", "frs", "archive", "STE-497.md");
  if (existsSync(archived)) return archived;
  throw new Error(
    "STE-497.md found in neither specs/frs/ nor specs/frs/archive/",
  );
}

// ===========================================================================
// The module under test, imported LAZILY.
//
// A top-level static import of a not-yet-written module aborts the whole file,
// which would collapse seven independent reds into one load error and hide
// which ACs are actually unmet. `frontmatter`, `milestone_token` and
// `requires_input` ARE imported statically above — they are shipped.
// ===========================================================================

const DELIVER_ARGUMENT_MODULE = "../adapters/_shared/src/deliver_argument";
const DELIVER_ARGUMENT_MODULE_FILE = join(SHARED_SRC, "deliver_argument.ts");

/** What an operator can hand `/deliver`. */
type DeliverArgumentKind =
  | "milestone_identity"
  | "fr_identity"
  | "feature_request";

interface DeliverArgumentClassification {
  readonly kind: DeliverArgumentKind;
  /** The argument verbatim, as the operator typed it. */
  readonly raw: string;
  /** The recognized identity token, or `null` for a feature request. */
  readonly identity: string | null;
}

/** How an identity is turned into files on disk. Injectable. */
interface IdentityProbe {
  /** Absolute path of the plan file for a milestone token, or `null`. */
  locatePlan(milestone: string): string | null;
  /** Full text of the FR file for an FR identity, or `null`. */
  readFr(identity: string): string | null;
}

/** The design phase, as a side effect the tests can watch. */
interface DeliverPhaseSink {
  enterDesign(request: string): void;
}

interface ResolveDeliverArgumentInput {
  readonly raw: string;
  readonly probe: IdentityProbe;
  readonly phases?: DeliverPhaseSink;
  /** Defaults to `true`; `false` is the `claude -p` shape. */
  readonly stdinIsTty?: boolean;
}

interface DeliverRouting {
  readonly kind: DeliverArgumentKind;
  readonly identity: string | null;
  /** The milestone token this argument routes to, or `null`. */
  readonly milestone: string | null;
  /** Absolute path of the located plan file, or `null`. */
  readonly planPath: string | null;
  /** True only for the feature-request path. */
  readonly entersDesignPhase: boolean;
}

interface DeliverArgumentModule {
  DELIVER_ARGUMENT_KINDS: readonly DeliverArgumentKind[];
  classifyDeliverArgument(raw: string): DeliverArgumentClassification;
  defaultIdentityProbe(repoRoot: string): IdentityProbe;
  resolveDeliverArgument(input: ResolveDeliverArgumentInput): DeliverRouting;
}

async function deliverArgument(): Promise<DeliverArgumentModule> {
  return (await import(
    DELIVER_ARGUMENT_MODULE
  )) as unknown as DeliverArgumentModule;
}

// ===========================================================================
// Fixtures + helpers.
// ===========================================================================

/** The three minted milestone forms, DERIVED from the shipped mint paths. */
const LINEAR_MILESTONE = "M129";
const JIRA_MILESTONE = milestoneIdFromEpicKey("PROJ-500"); // → M_PROJ_500
const SAMPLE_ULID = "fr_01KPR3M74XA75GJKT4Z4HG95TH";
const TRACKERLESS_MILESTONE = milestoneIdFromUlid(SAMPLE_ULID); // → M_HG95TH

const MINTED_MILESTONE_FORMS = [
  LINEAR_MILESTONE,
  JIRA_MILESTONE,
  TRACKERLESS_MILESTONE,
] as const;

/** Whole arguments that are NOT identities — real feature-request prose. */
const FEATURE_REQUESTS = [
  "add a dark mode toggle to the settings screen",
  "the CSV export drops the trailing row on large accounts, fix it",
  "I want the gate to report skip counts alongside pass counts",
  // Mentions a milestone token MID-SENTENCE. Recognition is anchored on the
  // whole argument, so this is prose, not an identity.
  "make the M129 routing story faster for big repos",
  // Mentions an FR ticket mid-sentence, same reason.
  "follow up on STE-492 with a proper end-to-end fixture",
] as const;

/** Tokens that are MALFORMED under the union grammar — never identities. */
const MALFORMED_TOKENS = ["M", "M_", "Mx", "M5-extra", "milestone-M5"] as const;

/** A plan body whose frontmatter binds it to a milestone. */
function frBody(milestone: string): string {
  return [
    "---",
    "title: some requirement",
    `milestone: ${milestone}`,
    "status: active",
    "archived_at: null",
    "---",
    "",
    "# some requirement",
    "",
  ].join("\n");
}

const FIXTURE_PLAN_MILESTONE = LINEAR_MILESTONE;
const FIXTURE_PLAN_PATH = "/abs/repo/specs/plan/M129.md";
const FIXTURE_FR_WITH_PLAN = "STE-901";
const FIXTURE_FR_WITHOUT_PLAN = "STE-902";
const MILESTONE_WITHOUT_PLAN = "M900";

/**
 * A probe that knows exactly one plan (`M129`) and two FRs — one bound to that
 * plan, one bound to a milestone with no plan at all.
 */
function fixtureProbe(): IdentityProbe {
  return {
    locatePlan(milestone: string): string | null {
      return milestone === FIXTURE_PLAN_MILESTONE ? FIXTURE_PLAN_PATH : null;
    },
    readFr(identity: string): string | null {
      if (identity === FIXTURE_FR_WITH_PLAN) return frBody(FIXTURE_PLAN_MILESTONE);
      if (identity === FIXTURE_FR_WITHOUT_PLAN)
        return frBody(MILESTONE_WITHOUT_PLAN);
      return null;
    },
  };
}

/** A probe that FAILS LOUDLY if consulted at all. */
function explodingProbe(): IdentityProbe {
  return {
    locatePlan(): string | null {
      throw new Error("probe.locatePlan was consulted when it must not be");
    },
    readFr(): string | null {
      throw new Error("probe.readFr was consulted when it must not be");
    },
  };
}

/** A design-phase sink that records every entry. */
function recordingSink(): DeliverPhaseSink & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    enterDesign(request: string): void {
      calls.push(request);
    },
  };
}

/** A design-phase sink that FAILS LOUDLY if the design phase is entered. */
function explodingSink(): DeliverPhaseSink {
  return {
    enterDesign(): void {
      throw new Error(
        "the design phase was entered for an argument that must never reach it",
      );
    },
  };
}

/** True when every needle appears in `body`, in the given order. */
function containsInOrder(body: string, needles: readonly string[]): boolean {
  let cursor = 0;
  for (const needle of needles) {
    const at = body.indexOf(needle, cursor);
    if (at === -1) return false;
    cursor = at + needle.length;
  }
  return true;
}

/**
 * True when `a` and `b` both occur in `body` within `window` characters of each
 * other, in either order. Prose pins use this instead of a whole-sentence
 * literal so the implementer keeps freedom of phrasing, while the two anchors
 * still have to appear as one thought rather than in unrelated sections.
 */
function nearby(body: string, a: string, b: string, window: number): boolean {
  const hay = body.toLowerCase();
  const needleA = a.toLowerCase();
  const needleB = b.toLowerCase();
  for (let i = hay.indexOf(needleA); i !== -1; i = hay.indexOf(needleA, i + 1)) {
    const lo = Math.max(0, i - window);
    const hi = Math.min(hay.length, i + needleA.length + window);
    if (hay.slice(lo, hi).includes(needleB)) return true;
  }
  return false;
}

/** Run `fn`, require it to throw, and hand the message back for more pins. */
function expectRefusal(fn: () => unknown, label: string): string {
  let raised: unknown = null;
  let returned: unknown = undefined;
  try {
    returned = fn();
  } catch (e) {
    raised = e;
  }
  expect(
    returned,
    `${label}: a routing came back instead of a refusal — the argument FELL THROUGH`,
  ).toBeUndefined();
  expect(raised, `${label}: nothing was refused`).not.toBeNull();
  return String((raised as Error).message);
}

/** Assert the NFR-10 canonical three-line refusal shape. */
function expectNfr10Shape(msg: string, label: string): void {
  expect(msg, `${label}: no Refusing:/Verdict: line`).toMatch(
    /^(Refusing|Verdict):/m,
  );
  expect(msg, `${label}: no Remedy: line`).toContain("Remedy:");
  expect(msg, `${label}: no Context: line`).toContain("Context:");
}

// AC.4 — the refusal must name BOTH plausible intents, and tell an operator who
// meant the second one how to proceed.
const RESUME_INTENT =
  /existing milestone|already (exists|shipped|planned)|plan file|no plan|milestone .{0,30}(exists|on disk)/i;
const NEW_WORK_INTENT = /new work|something new|fresh (idea|feature|work)/i;
const HOW_TO_START_NEW =
  /describe|in (your own )?words|as a feature request|in prose|state the (feature|idea)/i;

function namesBothIntents(msg: string): boolean {
  return (
    RESUME_INTENT.test(msg) &&
    NEW_WORK_INTENT.test(msg) &&
    HOW_TO_START_NEW.test(msg)
  );
}

// The shipped non-tty FIRST ACTION blockquote AC.7 restates. It must survive
// verbatim and in order — widening the argument grammar must not widen this.
const SHIPPED_NON_TTY_CLAUSES = [
  "**FIRST ACTION (under non-interactive stdin).**",
  "`requireOrRefuse(...)`",
  "**There is no marker carve-out**",
  "under non-tty stdin the refusal is unconditional",
] as const;

/** Phrasings that would CARVE OUT an identity argument from the non-tty gate. */
const NON_TTY_CARVE_OUTS = [
  /identit(?:y|ies)[^.\n]{0,80}(?:may|can|is allowed to)[^.\n]{0,40}(?:proceed|run|resume)/i,
  /(?:milestone|fr) identit(?:y|ies)[^.\n]{0,60}(?:exempt|carve-?out|exception)/i,
  /non-?tty[^.\n]{0,60}(?:except|unless)[^.\n]{0,40}identit/i,
];

// The Phases 1–2 guarantee AC.6 must leave untouched — the feature-request path
// is exactly what it is today.
const SHIPPED_INLINE_PHASE_CLAUSES = [
  "## Phases 1–2 — design and spec-writing, inline",
  "Phases 1–2 run **inline in the invoking session**",
  "never proxies",
] as const;

// ===========================================================================
// TRIPWIRES — written first; they are what stops a bad "fix".
// ===========================================================================

describe("TRIPWIRE — the surfaces and budgets this FR's edits ride against", () => {
  const SKILL_LINE_CAP = 358;
  const SKILLS_STE_TOKEN_CEILING = 246;

  test("the FR still names all SEVEN ACs this file is written against", () => {
    const fr = read(frPath());
    for (let n = 1; n <= 7; n++) {
      expect(fr, `AC-STE-497.${n} missing from the FR`).toContain(
        `AC-STE-497.${n}:`,
      );
    }
  });

  test(`skills/deliver/SKILL.md stays within the NFR-1 line cap (${SKILL_LINE_CAP})`, () => {
    // 119 / 358 at authoring time — ample room for the grammar prose.
    expect(DELIVER_SKILL().split("\n").length).toBeLessThanOrEqual(
      SKILL_LINE_CAP,
    );
  });

  test("skills/deliver/SKILL.md keeps a VALID frontmatter block", () => {
    const fm = parseFrontmatter(DELIVER_SKILL());
    expect(fm.name).toBe("deliver");
    expect(String(fm.description)).toContain("pipeline");
  });

  test(`the skills/ STE-token ceiling (${SKILLS_STE_TOKEN_CEILING}) is not breached`, () => {
    let count = 0;
    const walk = (d: string): void => {
      for (const name of readdirSync(d)) {
        const p = join(d, name);
        if (statSync(p).isDirectory()) {
          walk(p);
          continue;
        }
        if (!name.endsWith(".md")) continue;
        count += (read(p).match(/\b(STE|AC-STE)-\d+(?:\.\d+)?\b/g) ?? []).length;
      }
    };
    walk(SKILLS_DIR);
    expect(count).toBeLessThanOrEqual(SKILLS_STE_TOKEN_CEILING);
  });

  test("the roster is unchanged — 27 skills, 8 agents", () => {
    // Argument recognition is a `/deliver` capability, not a new surface.
    expect(readdirSync(SKILLS_DIR).length).toBe(27);
    expect(readdirSync(AGENTS_DIR).length).toBe(8);
  });

  test("the `/deliver` reference is still the pointed-at companion document", () => {
    expect(existsSync(DELIVER_REFERENCE_FILE)).toBe(true);
    expect(DELIVER_SKILL()).toContain("docs/deliver-reference.md");
  });

  test("containsInOrder REJECTS a mutated body — the order helper is not vacuous", () => {
    const body = "alpha\nbeta\ngamma\n";
    expect(containsInOrder(body, ["alpha", "beta", "gamma"])).toBe(true);
    expect(containsInOrder(body, ["gamma", "alpha"])).toBe(false);
    expect(containsInOrder(body, ["alpha", "delta"])).toBe(false);
  });

  test("nearby REJECTS anchors that are far apart or absent", () => {
    const body = `alpha${" ".repeat(500)}beta`;
    expect(nearby(body, "alpha", "beta", 600)).toBe(true);
    expect(nearby(body, "beta", "alpha", 600)).toBe(true);
    expect(nearby(body, "alpha", "beta", 100)).toBe(false);
    expect(nearby(body, "alpha", "gamma", 10_000)).toBe(false);
  });

  test("the exploding fixtures really throw — the never-consulted pins are not vacuous", () => {
    const probe = explodingProbe();
    expect(() => probe.locatePlan("M1")).toThrow();
    expect(() => probe.readFr("STE-1")).toThrow();
    expect(() => explodingSink().enterDesign("x")).toThrow();
  });

  test("namesBothIntents REJECTS a message that names only one intent", () => {
    // Without this control, AC.4 would be satisfied by any refusal at all.
    expect(
      namesBothIntents("Refusing: no plan file exists for M900."),
      "a resume-only message counted as naming both intents",
    ).toBe(false);
    expect(
      namesBothIntents("Remedy: describe the new work you want in your own words."),
      "a new-work-only message counted as naming both intents",
    ).toBe(false);
    expect(
      namesBothIntents(
        "Refusing: M900 names no plan file on disk. Remedy: if you meant to " +
          "start new work, describe it in your own words instead.",
      ),
    ).toBe(true);
  });

  test("the three minted milestone forms really are three DISTINCT shapes", () => {
    // Derived from the shipped mint paths, not retyped — so AC.2's corpus can
    // never silently shrink to the numeric form.
    expect(JIRA_MILESTONE).toBe("M_PROJ_500");
    expect(TRACKERLESS_MILESTONE).toBe("M_HG95TH");
    expect(new Set<string>(MINTED_MILESTONE_FORMS).size).toBe(3);
  });
});

// ===========================================================================
// AC-STE-497.1 — the argument grammar admits a milestone identity and an FR
// identity alongside a feature request.
// ===========================================================================

describe("AC-STE-497.1 — three argument kinds, not one", () => {
  test("the module exists at its pinned path under adapters/_shared/src", () => {
    expect(existsSync(DELIVER_ARGUMENT_MODULE_FILE)).toBe(true);
  });

  test("the grammar's vocabulary is exactly the three kinds", async () => {
    const { DELIVER_ARGUMENT_KINDS } = await deliverArgument();
    expect([...DELIVER_ARGUMENT_KINDS]).toEqual([
      "milestone_identity",
      "fr_identity",
      "feature_request",
    ]);
  });

  test("a milestone identity classifies as one, carrying the token", async () => {
    const { classifyDeliverArgument } = await deliverArgument();
    for (const token of MINTED_MILESTONE_FORMS) {
      const c = classifyDeliverArgument(token);
      expect(c.kind, token).toBe("milestone_identity");
      expect(c.identity, token).toBe(token);
      expect(c.raw, token).toBe(token);
    }
  });

  test("an FR identity classifies as one — tracker ref and minted id alike", async () => {
    const { classifyDeliverArgument } = await deliverArgument();
    for (const token of ["STE-497", "STE-492", "DST-66", SAMPLE_ULID]) {
      const c = classifyDeliverArgument(token);
      expect(c.kind, token).toBe("fr_identity");
      expect(c.identity, token).toBe(token);
    }
  });

  test("surrounding whitespace does not defeat recognition", async () => {
    const { classifyDeliverArgument } = await deliverArgument();
    for (const raw of ["  M129", "M129\n", "\t STE-497 \n"]) {
      const c = classifyDeliverArgument(raw);
      expect(c.kind, JSON.stringify(raw)).not.toBe("feature_request");
      expect(c.identity, JSON.stringify(raw)).toBe(raw.trim());
    }
  });

  test("ISOLATION: a feature request is still a feature request", async () => {
    // Without this, "identities are recognized" would be satisfied by a
    // classifier that calls everything an identity.
    const { classifyDeliverArgument } = await deliverArgument();
    for (const raw of FEATURE_REQUESTS) {
      const c = classifyDeliverArgument(raw);
      expect(c.kind, raw).toBe("feature_request");
      expect(c.identity, raw).toBeNull();
    }
  });

  test("PROSE: the argument hint admits an identity and still admits prose", () => {
    const line = DELIVER_SKILL()
      .split("\n")
      .find((l) => l.startsWith("argument-hint:"));
    expect(line, "the argument-hint key vanished").toBeDefined();
    // The house idiom: a single-quoted one-liner.
    expect(line!, "the argument-hint is not the single-quoted one-line idiom").toMatch(
      /^argument-hint: '[^'\n]+'$/,
    );
    expect(line!.toLowerCase(), "the hint never mentions a milestone").toContain(
      "milestone",
    );
    expect(
      /feature request|idea/i.test(line!),
      "the hint dropped the feature-request form it has always accepted",
    ).toBe(true);
  });
});

// ===========================================================================
// AC-STE-497.2 — recognition rides the SHARED milestone-token grammar.
//
// The grammar is a UNION. A hand-rolled `M\d+` recognizes the Linear form and
// silently misroutes the Jira-Epic and tracker-less ones — the exact defect
// this AC exists to forbid.
// ===========================================================================

describe("AC-STE-497.2 — the shared union grammar, not a private pattern", () => {
  test("ALL THREE minted forms are recognized", async () => {
    const { classifyDeliverArgument } = await deliverArgument();
    for (const token of MINTED_MILESTONE_FORMS) {
      expect(
        classifyDeliverArgument(token).kind,
        `${token} was not recognized as a milestone identity — a private M\\d+ pattern?`,
      ).toBe("milestone_identity");
    }
  });

  test("more numeric and epic-keyed forms, from the same grammar", async () => {
    const { classifyDeliverArgument } = await deliverArgument();
    for (const token of ["M1", "M42", "M1000", "M_PROJ-500", "M_ABC123"]) {
      expect(classifyDeliverArgument(token).kind, token).toBe(
        "milestone_identity",
      );
    }
  });

  test("ISOLATION: malformed tokens are NOT milestone identities", async () => {
    // The union grammar is anchored and rejects these; a loose pattern would
    // accept `M5-extra` by prefix match.
    const { classifyDeliverArgument } = await deliverArgument();
    for (const token of MALFORMED_TOKENS) {
      expect(
        classifyDeliverArgument(token).kind,
        `${token} was accepted as a milestone identity`,
      ).not.toBe("milestone_identity");
    }
  });

  test("the module IMPORTS the shared grammar module", async () => {
    await deliverArgument();
    expect(
      read(DELIVER_ARGUMENT_MODULE_FILE),
      "the module does not import ./milestone_token",
    ).toContain('from "./milestone_token"');
  });

  test("the module keeps NO private numeric milestone pattern", async () => {
    // The STE-335 audit idiom: grep the consumer for a private copy so the one
    // home for the grammar cannot quietly grow a second.
    await deliverArgument();
    const src = read(DELIVER_ARGUMENT_MODULE_FILE);
    const withoutComments = src
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
      .join("\n");
    for (const re of [/M\\d\+/, /M\[0-9\]/, /M\(\\d\+\)/]) {
      expect(
        re.test(withoutComments),
        `a private milestone pattern (${re}) lives in the module`,
      ).toBe(false);
    }
  });
});

// ===========================================================================
// AC-STE-497.3 — an identity naming no plan file refuses, and never falls
// through to the design phase.
//
// TWO claims. The second is the one a naive assertion misses, so the design
// phase is a real observable here, not an inference.
// ===========================================================================

describe("AC-STE-497.3 — refuse, and do not brainstorm it anyway", () => {
  test("PRIMARY: an unknown milestone identity refuses and returns NOTHING", async () => {
    const { resolveDeliverArgument } = await deliverArgument();
    for (const token of [MILESTONE_WITHOUT_PLAN, "M_NOPE", "M4242"]) {
      const msg = expectRefusal(
        () =>
          resolveDeliverArgument({
            // Explicit: the module DERIVES tty-ness from the process, which is
            // non-tty under `bun test`. This leg exercises the interactive path.
            stdinIsTty: true,
            raw: token,
            probe: fixtureProbe(),
            phases: recordingSink(),
          }),
        token,
      );
      expectNfr10Shape(msg, token);
      expect(msg, `${token}: the refusal never quotes the identity`).toContain(
        token,
      );
    }
  });

  test("MUTATION-VERIFIED SECOND HALF: the design phase is never entered", async () => {
    // A refusal that ALSO entered design would pass "did it throw?" and fail
    // here — the sink recorded a call.
    const { resolveDeliverArgument } = await deliverArgument();
    const sink = recordingSink();
    expectRefusal(
      () =>
        resolveDeliverArgument({
          // Explicit: the module DERIVES tty-ness from the process, which is
          // non-tty under `bun test`. This leg exercises the interactive path.
          stdinIsTty: true,
          raw: MILESTONE_WITHOUT_PLAN,
          probe: fixtureProbe(),
          phases: sink,
        }),
      "recording sink",
    );
    expect(
      sink.calls,
      "the refused identity STILL fell through to the design phase",
    ).toEqual([]);
  });

  test("MUTATION-VERIFIED, second reading: an exploding sink is never touched", async () => {
    // Complementary shape: if design were entered, the sink's own distinctive
    // error would replace the refusal and the NFR-10 assertion below fails.
    const { resolveDeliverArgument } = await deliverArgument();
    const msg = expectRefusal(
      () =>
        resolveDeliverArgument({
          // Explicit: the module DERIVES tty-ness from the process, which is
          // non-tty under `bun test`. This leg exercises the interactive path.
          stdinIsTty: true,
          raw: MILESTONE_WITHOUT_PLAN,
          probe: fixtureProbe(),
          phases: explodingSink(),
        }),
      "exploding sink",
    );
    expect(
      msg,
      "the design phase was entered before the refusal",
    ).not.toContain("the design phase was entered");
    expectNfr10Shape(msg, "exploding sink");
  });

  test("the refusal is a NAMED error carrying structured context", async () => {
    const { resolveDeliverArgument } = await deliverArgument();
    let raised: unknown = null;
    try {
      resolveDeliverArgument({
        // Explicit: the module DERIVES tty-ness from the process, which is
        // non-tty under `bun test`. This leg exercises the interactive path.
        stdinIsTty: true,
        raw: MILESTONE_WITHOUT_PLAN,
        probe: fixtureProbe(),
        phases: recordingSink(),
      });
    } catch (e) {
      raised = e;
    }
    expect(raised).not.toBeNull();
    expect((raised as Error).name).toMatch(/Deliver/);
    expect((raised as Error).message).toMatch(/Context:.*M900/s);
  });

  test("ISOLATION: an identity WITH a plan file genuinely RESOLVES", async () => {
    // Without this, "unknown identities are refused" would be satisfied by a
    // resolver that refuses every identity it ever sees.
    const { resolveDeliverArgument } = await deliverArgument();
    const sink = recordingSink();
    const routing = resolveDeliverArgument({
      // Explicit: the module DERIVES tty-ness from the process, which is
      // non-tty under `bun test`. This leg exercises the interactive path.
      stdinIsTty: true,
      raw: FIXTURE_PLAN_MILESTONE,
      probe: fixtureProbe(),
      phases: sink,
    });
    expect(routing.kind).toBe("milestone_identity");
    expect(routing.identity).toBe(FIXTURE_PLAN_MILESTONE);
    expect(routing.milestone).toBe(FIXTURE_PLAN_MILESTONE);
    expect(routing.planPath).toBe(FIXTURE_PLAN_PATH);
    expect(
      routing.entersDesignPhase,
      "a known milestone was routed into the design phase",
    ).toBe(false);
    expect(sink.calls, "a known milestone entered the design phase").toEqual([]);
  });

  test("REAL DISK: the default probe finds active and archived plans, and only real ones", async () => {
    const { defaultIdentityProbe } = await deliverArgument();
    const probe = defaultIdentityProbe(REPO_ROOT);
    const m129 = probe.locatePlan("M129");
    expect(m129, "the active plan M129.md was not located").not.toBeNull();
    expect(basename(m129!)).toBe("M129.md");
    const m1 = probe.locatePlan("M1");
    expect(m1, "the archived plan M1.md was not located").not.toBeNull();
    expect(basename(m1!)).toBe("M1.md");
    expect(
      probe.locatePlan(MILESTONE_WITHOUT_PLAN),
      "a nonexistent plan was located",
    ).toBeNull();
    expect(probe.locatePlan("M_NOPE_497")).toBeNull();
  });

  test("END TO END on real disk: M129 resolves, M900 refuses", async () => {
    const { resolveDeliverArgument, defaultIdentityProbe } =
      await deliverArgument();
    const probe = defaultIdentityProbe(REPO_ROOT);
    const routing = resolveDeliverArgument({
      // Explicit: the module DERIVES tty-ness from the process, which is
      // non-tty under `bun test`. This leg exercises the interactive path.
      stdinIsTty: true,
      raw: "M129",
      probe,
      phases: explodingSink(),
    });
    expect(routing.milestone).toBe("M129");
    expect(basename(routing.planPath!)).toBe("M129.md");
    expect(routing.entersDesignPhase).toBe(false);

    const msg = expectRefusal(
      () =>
        resolveDeliverArgument({
          // Explicit: the module DERIVES tty-ness from the process, which is
          // non-tty under `bun test`. This leg exercises the interactive path.
          stdinIsTty: true,
          raw: MILESTONE_WITHOUT_PLAN,
          probe,
          phases: explodingSink(),
        }),
      "real disk M900",
    );
    expectNfr10Shape(msg, "real disk M900");
  });

  test("PROSE: the surfaces state the refusal and rule out the design phase", () => {
    const surfaces = DELIVER_SURFACES();
    expect(
      surfaces.toLowerCase(),
      "no `/deliver` surface has any design-phase vocabulary at all",
    ).toContain("design phase");
    expect(
      nearby(surfaces, "design phase", "Refusing:", 1500),
      "the surfaces never tie the design phase to a refusal",
    ).toBe(true);
  });
});

// ===========================================================================
// AC-STE-497.4 — the refusal names BOTH plausible intents.
// ===========================================================================

describe("AC-STE-497.4 — an operator who meant new work is not stranded", () => {
  test("the refusal names the existing-milestone intent AND the new-work intent", async () => {
    const { resolveDeliverArgument } = await deliverArgument();
    for (const token of [MILESTONE_WITHOUT_PLAN, "M_NOPE"]) {
      const msg = expectRefusal(
        () =>
          resolveDeliverArgument({
            // Explicit: the module DERIVES tty-ness from the process, which is
            // non-tty under `bun test`. This leg exercises the interactive path.
            stdinIsTty: true,
            raw: token,
            probe: fixtureProbe(),
            phases: recordingSink(),
          }),
        token,
      );
      expect(
        RESUME_INTENT.test(msg),
        `${token}: the refusal never says the plan could not be found`,
      ).toBe(true);
      expect(
        NEW_WORK_INTENT.test(msg),
        `${token}: the refusal never names the start-new-work intent`,
      ).toBe(true);
      expect(
        HOW_TO_START_NEW.test(msg),
        `${token}: the refusal never says HOW to start new work`,
      ).toBe(true);
      expect(namesBothIntents(msg), `${token}: both intents not named`).toBe(true);
    }
  });

  test("the how-to lives in the Remedy line, where an operator reads it", async () => {
    const { resolveDeliverArgument } = await deliverArgument();
    const msg = expectRefusal(
      () =>
        resolveDeliverArgument({
          // Explicit: the module DERIVES tty-ness from the process, which is
          // non-tty under `bun test`. This leg exercises the interactive path.
          stdinIsTty: true,
          raw: MILESTONE_WITHOUT_PLAN,
          probe: fixtureProbe(),
          phases: recordingSink(),
        }),
      "remedy",
    );
    const remedy = msg.slice(msg.indexOf("Remedy:"));
    expect(
      NEW_WORK_INTENT.test(remedy),
      "the new-work intent is nowhere in the Remedy line",
    ).toBe(true);
  });

  test("an FR identity's refusal names both intents too", async () => {
    const { resolveDeliverArgument } = await deliverArgument();
    const msg = expectRefusal(
      () =>
        resolveDeliverArgument({
          // Explicit: the module DERIVES tty-ness from the process, which is
          // non-tty under `bun test`. This leg exercises the interactive path.
          stdinIsTty: true,
          raw: FIXTURE_FR_WITHOUT_PLAN,
          probe: fixtureProbe(),
          phases: recordingSink(),
        }),
      "fr refusal",
    );
    expect(namesBothIntents(msg)).toBe(true);
  });

  test("PROSE: the surfaces name the new-work intent alongside the design phase", () => {
    const surfaces = DELIVER_SURFACES();
    expect(
      surfaces.toLowerCase(),
      "no `/deliver` surface mentions starting new work",
    ).toContain("new work");
    expect(
      nearby(surfaces, "new work", "design phase", 1500),
      "the surfaces never tell an operator that new work is what the design phase is for",
    ).toBe(true);
  });
});

// ===========================================================================
// AC-STE-497.5 — an FR identity resolves through its `milestone:` frontmatter.
//
// It no longer follows the SAME routing: STE-499 (M130) gave the routing a
// scope, so an FR resolves to FR scope while carrying that milestone. What
// these legs assert is REFUSAL PARITY — the FR path refuses on the same terms
// the milestone path does — which STE-499 AC.4 re-asserts and depends on.
// ===========================================================================

describe("AC-STE-497.5 — an FR identity resolves its milestone", () => {
  test("an FR bound to a milestone WITH a plan resolves, no design phase", async () => {
    const { resolveDeliverArgument } = await deliverArgument();
    const sink = recordingSink();
    const routing = resolveDeliverArgument({
      // Explicit: the module DERIVES tty-ness from the process, which is
      // non-tty under `bun test`. This leg exercises the interactive path.
      stdinIsTty: true,
      raw: FIXTURE_FR_WITH_PLAN,
      probe: fixtureProbe(),
      phases: sink,
    });
    expect(routing.kind).toBe("fr_identity");
    expect(routing.identity).toBe(FIXTURE_FR_WITH_PLAN);
    expect(routing.milestone, "the `milestone:` frontmatter was not read").toBe(
      FIXTURE_PLAN_MILESTONE,
    );
    expect(routing.planPath).toBe(FIXTURE_PLAN_PATH);
    expect(routing.entersDesignPhase).toBe(false);
    expect(sink.calls).toEqual([]);
  });

  test("REFUSAL PARITY: an FR bound to a milestone with NO plan refuses identically", async () => {
    const { resolveDeliverArgument } = await deliverArgument();
    const msg = expectRefusal(
      () =>
        resolveDeliverArgument({
          // Explicit: the module DERIVES tty-ness from the process, which is
          // non-tty under `bun test`. This leg exercises the interactive path.
          stdinIsTty: true,
          raw: FIXTURE_FR_WITHOUT_PLAN,
          probe: fixtureProbe(),
          phases: explodingSink(),
        }),
      "fr without plan",
    );
    expectNfr10Shape(msg, "fr without plan");
    expect(msg, "the refusal never names the FR identity").toContain(
      FIXTURE_FR_WITHOUT_PLAN,
    );
    expect(
      msg,
      "the refusal never names the milestone the FR resolved to",
    ).toContain(MILESTONE_WITHOUT_PLAN);
  });

  test("an FR identity naming no FR file on disk is refused, not brainstormed", async () => {
    const { resolveDeliverArgument } = await deliverArgument();
    const msg = expectRefusal(
      () =>
        resolveDeliverArgument({
          // Explicit: the module DERIVES tty-ness from the process, which is
          // non-tty under `bun test`. This leg exercises the interactive path.
          stdinIsTty: true,
          raw: "STE-90909",
          probe: fixtureProbe(),
          phases: explodingSink(),
        }),
      "unknown fr",
    );
    expectNfr10Shape(msg, "unknown fr");
    expect(msg).toContain("STE-90909");
  });

  test("NON-VACUITY: the frontmatter value actually decides the routing", async () => {
    // Two FR bodies differing ONLY in their `milestone:` line must route to two
    // different milestones — otherwise "resolves to its frontmatter" would be
    // satisfied by a resolver that ignores the file.
    const { resolveDeliverArgument } = await deliverArgument();
    const probe: IdentityProbe = {
      locatePlan: (m) => (m === "M129" ? FIXTURE_PLAN_PATH : null),
      readFr: (id) => (id === "STE-903" ? frBody("M129") : frBody("M900")),
    };
    expect(
      resolveDeliverArgument({
  // Explicit: the module DERIVES tty-ness from the process, which is
  // non-tty under `bun test`. This leg exercises the interactive path.
  stdinIsTty: true, raw: "STE-903", probe, phases: recordingSink() })
        .milestone,
    ).toBe("M129");
    const msg = expectRefusal(
      () =>
        resolveDeliverArgument({
          // Explicit: the module DERIVES tty-ness from the process, which is
          // non-tty under `bun test`. This leg exercises the interactive path.
          stdinIsTty: true,
          raw: "STE-904",
          probe,
          phases: recordingSink(),
        }),
      "other frontmatter",
    );
    expect(msg).toContain("M900");
  });

  test("the FR frontmatter is read through the SHARED helper — CRLF and BOM tolerated", async () => {
    const { resolveDeliverArgument } = await deliverArgument();
    const lf = frBody(FIXTURE_PLAN_MILESTONE);
    for (const [label, body] of [
      ["CRLF", lf.replace(/\n/g, "\r\n")],
      ["lone CR", lf.replace(/\n/g, "\r")],
      ["BOM", `﻿${lf}`],
      ["BOM + CRLF", `﻿${lf.replace(/\n/g, "\r\n")}`],
    ] as const) {
      const probe: IdentityProbe = {
        locatePlan: (m) => (m === FIXTURE_PLAN_MILESTONE ? FIXTURE_PLAN_PATH : null),
        readFr: () => body,
      };
      const routing = resolveDeliverArgument({
        // Explicit: the module DERIVES tty-ness from the process, which is
        // non-tty under `bun test`. This leg exercises the interactive path.
        stdinIsTty: true,
        raw: "STE-905",
        probe,
        phases: recordingSink(),
      });
      expect(routing.milestone, label).toBe(FIXTURE_PLAN_MILESTONE);
    }
  });

  test("the module READS frontmatter through the shared helper, not by hand", async () => {
    await deliverArgument();
    expect(read(DELIVER_ARGUMENT_MODULE_FILE)).toContain('from "./frontmatter"');
  });

  test("REAL DISK: the default probe reads FR files, active and archived", async () => {
    const { defaultIdentityProbe } = await deliverArgument();
    const probe = defaultIdentityProbe(REPO_ROOT);
    const active = probe.readFr("STE-497");
    expect(active, "the FR under test was not located on disk").not.toBeNull();
    expect(active!).toContain("milestone: M129");
    // A minted id resolves to its short-slice filename, the house convention.
    const archived = probe.readFr(SAMPLE_ULID);
    expect(archived, "an archived FR was not located by its minted id").not.toBeNull();
    expect(archived!).toContain("milestone: M1");
    expect(probe.readFr("STE-90909"), "a nonexistent FR was read").toBeNull();
  });

  test("END TO END on real disk: an FR identity routes to its milestone's plan", async () => {
    const { resolveDeliverArgument, defaultIdentityProbe } =
      await deliverArgument();
    const routing = resolveDeliverArgument({
      // Explicit: the module DERIVES tty-ness from the process, which is
      // non-tty under `bun test`. This leg exercises the interactive path.
      stdinIsTty: true,
      raw: "STE-497",
      probe: defaultIdentityProbe(REPO_ROOT),
      phases: explodingSink(),
    });
    expect(routing.kind).toBe("fr_identity");
    expect(routing.milestone).toBe("M129");
    expect(basename(routing.planPath!)).toBe("M129.md");
    expect(routing.entersDesignPhase).toBe(false);
  });
});

// ===========================================================================
// AC-STE-497.6 — a non-identity argument behaves exactly as it does today.
//
// The backward-compatibility spine. Every leg here goes RED if ordinary prose
// stops reaching the design phase.
// ===========================================================================

describe("AC-STE-497.6 — ordinary feature-request prose is untouched", () => {
  test("real prose enters the design phase, once, with the operator's own words", async () => {
    const { resolveDeliverArgument } = await deliverArgument();
    for (const raw of FEATURE_REQUESTS) {
      const sink = recordingSink();
      const routing = resolveDeliverArgument({
        // Explicit: the module DERIVES tty-ness from the process, which is
        // non-tty under `bun test`. This leg exercises the interactive path.
        stdinIsTty: true,
        raw,
        // A feature request needs no identity lookup at all: the probe throws.
        probe: explodingProbe(),
        phases: sink,
      });
      expect(routing.kind, raw).toBe("feature_request");
      expect(routing.identity, raw).toBeNull();
      expect(routing.milestone, raw).toBeNull();
      expect(routing.planPath, raw).toBeNull();
      expect(
        routing.entersDesignPhase,
        `${raw}: a feature request stopped reaching the design phase`,
      ).toBe(true);
      expect(sink.calls.length, `${raw}: design entered ${sink.calls.length}×`).toBe(1);
      expect(sink.calls[0]!.trim(), raw).toBe(raw.trim());
    }
  });

  test("prose is never refused", async () => {
    const { resolveDeliverArgument } = await deliverArgument();
    for (const raw of FEATURE_REQUESTS) {
      expect(() =>
        resolveDeliverArgument({
          // Explicit: the module DERIVES tty-ness from the process, which is
          // non-tty under `bun test`. This leg exercises the interactive path.
          stdinIsTty: true,
          raw,
          probe: explodingProbe(),
          phases: recordingSink(),
        }),
      ).not.toThrow();
    }
  });

  test("a malformed identity-ish token is prose, and reaches design", async () => {
    // `M5-extra` is not a milestone under the union grammar. The safe reading
    // is prose — the operator gets the pipeline they have always had.
    const { resolveDeliverArgument } = await deliverArgument();
    for (const token of MALFORMED_TOKENS) {
      const sink = recordingSink();
      const routing = resolveDeliverArgument({
        // Explicit: the module DERIVES tty-ness from the process, which is
        // non-tty under `bun test`. This leg exercises the interactive path.
        stdinIsTty: true,
        raw: token,
        probe: explodingProbe(),
        phases: sink,
      });
      expect(routing.kind, token).toBe("feature_request");
      expect(sink.calls.length, token).toBe(1);
    }
  });

  test("ISOLATION: the SAME resolver does NOT send an identity to design", async () => {
    // Without this, "prose reaches design" would be satisfied by a resolver
    // that sends everything to design — the shipped defect.
    const { resolveDeliverArgument } = await deliverArgument();
    const sink = recordingSink();
    resolveDeliverArgument({
      // Explicit: the module DERIVES tty-ness from the process, which is
      // non-tty under `bun test`. This leg exercises the interactive path.
      stdinIsTty: true,
      raw: FIXTURE_PLAN_MILESTONE,
      probe: fixtureProbe(),
      phases: sink,
    });
    expect(sink.calls).toEqual([]);
  });

  test("the shipped inline-phases guarantee survives verbatim, in order", () => {
    const body = DELIVER_SKILL();
    for (const clause of SHIPPED_INLINE_PHASE_CLAUSES) {
      expect(body, `shipped inline-phase clause lost: ${clause}`).toContain(
        clause,
      );
    }
    expect(containsInOrder(body, SHIPPED_INLINE_PHASE_CLAUSES)).toBe(true);
    expect(body).toContain(
      "Each question reaches the operator exactly as the phase skill asks it, in order, one at a time.",
    );
  });
});

// ===========================================================================
// AC-STE-497.7 — under non-tty stdin EVERY form still refuses with the
// canonical marker. Identity recognition earns no carve-out.
// ===========================================================================

describe("AC-STE-497.7 — the non-tty gate covers the widened grammar", () => {
  const EVERY_FORM: readonly string[] = [
    FIXTURE_PLAN_MILESTONE, // an identity that WOULD have resolved
    MILESTONE_WITHOUT_PLAN, // an identity that would have been refused anyway
    JIRA_MILESTONE,
    TRACKERLESS_MILESTONE,
    FIXTURE_FR_WITH_PLAN, // an FR identity that WOULD have resolved
    FEATURE_REQUESTS[0]!, // ordinary prose
  ];

  test("every argument form refuses under non-tty stdin", async () => {
    const { resolveDeliverArgument } = await deliverArgument();
    for (const raw of EVERY_FORM) {
      const msg = expectRefusal(
        () =>
          resolveDeliverArgument({
            raw,
            // FIRST ACTION: neither the probe nor the design phase may be
            // touched before the refusal fires. Both explode if they are.
            probe: explodingProbe(),
            phases: explodingSink(),
            stdinIsTty: false,
          }),
        `non-tty ${raw}`,
      );
      expect(
        msg,
        `non-tty ${raw}: the canonical refusal marker is missing`,
      ).toContain(REQUIRES_INPUT_REFUSED_MARKER);
      expectNfr10Shape(msg, `non-tty ${raw}`);
    }
  });

  test("the marker is the LAST line, per the shared renderer's contract", async () => {
    const { resolveDeliverArgument } = await deliverArgument();
    const msg = expectRefusal(
      () =>
        resolveDeliverArgument({
          raw: FIXTURE_PLAN_MILESTONE,
          probe: explodingProbe(),
          phases: explodingSink(),
          stdinIsTty: false,
        }),
      "marker position",
    );
    expect(msg.trimEnd().endsWith(REQUIRES_INPUT_REFUSED_MARKER)).toBe(true);
  });

  test("ISOLATION: the SAME forms are NOT refused on a tty", async () => {
    // Without this, AC.7 would be satisfied by a resolver that refuses
    // everything always — which would also "satisfy" AC.3 and break AC.6.
    const { resolveDeliverArgument } = await deliverArgument();
    expect(() =>
      resolveDeliverArgument({
        raw: FIXTURE_PLAN_MILESTONE,
        probe: fixtureProbe(),
        phases: recordingSink(),
        stdinIsTty: true,
      }),
    ).not.toThrow();
    expect(() =>
      resolveDeliverArgument({
        raw: FEATURE_REQUESTS[0]!,
        probe: fixtureProbe(),
        phases: recordingSink(),
        stdinIsTty: true,
      }),
    ).not.toThrow();
  });

  test("the module SOURCES the marker rather than retyping it", async () => {
    await deliverArgument();
    const src = read(DELIVER_ARGUMENT_MODULE_FILE);
    expect(src, "the module does not import ./requires_input").toContain(
      'from "./requires_input"',
    );
    expect(
      src.includes("<dpt:requires-input-refused>"),
      "the marker literal was RETYPED into the module instead of imported",
    ).toBe(false);
  });

  test("the shipped FIRST ACTION blockquote survives verbatim, in order", () => {
    const body = DELIVER_SKILL();
    for (const clause of SHIPPED_NON_TTY_CLAUSES) {
      expect(body, `shipped non-tty clause lost: ${clause}`).toContain(clause);
    }
    expect(containsInOrder(body, SHIPPED_NON_TTY_CLAUSES)).toBe(true);
    expect(body, "the canonical marker left the skill surface").toContain(
      REQUIRES_INPUT_REFUSED_MARKER,
    );
  });

  test("no `/deliver` surface carves an identity out of the non-tty refusal", () => {
    const surfaces = DELIVER_SURFACES();
    for (const re of NON_TTY_CARVE_OUTS) {
      expect(re.test(surfaces), `a non-tty carve-out appeared: ${re}`).toBe(
        false,
      );
    }
  });

  test("NON-VACUITY: the carve-out patterns DO match a permissive sentence", () => {
    // Without this control, "no carve-out appears" would be satisfied by
    // patterns that match nothing at all.
    const permissive = [
      "A milestone identity may proceed headless because no question is asked.",
      "A milestone identity is exempt from the refusal.",
      "The non-tty refusal applies except when the argument is an identity.",
    ];
    for (const sentence of permissive) {
      expect(
        NON_TTY_CARVE_OUTS.some((re) => re.test(sentence)),
        `no pattern matched: ${sentence}`,
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// AC-STE-497.1/.3/.4 — the OPERATIVE surface carries the identity contract.
//
// Third instance in this milestone of the same defect: routing implemented in
// code and documented ONLY in docs/deliver-reference.md, the file
// skills/deliver/SKILL.md marks "not required reading" immediately after saying
// "The sections below are sufficient to operate".
//
// It is worse here than for STE-495. The SKILL's argument-hint was widened to
// ADVERTISE that an identity is accepted, while the body gave no instruction
// for one — so a run reading only the operative surface would take `M45`, find
// nothing, and fall through to Phase 1 and brainstorm a shipped milestone.
// That is precisely the defect this FR exists to fix, left live on the surface
// that operates.
// ---------------------------------------------------------------------------

describe("AC-STE-497.3 — the identity contract is on the operative SKILL surface", () => {
  // Only the SKILL. The reference is explicitly optional reading, so a claim
  // that lives there alone does not reach a run.
  const operative = (): string => DELIVER_SKILL();

  test("the SKILL states that an argument is classified BEFORE the design phase", () => {
    const body = operative();
    expect(body).toContain("deliver_argument.ts");
    // The classification must be ordered ahead of Phase 1, not merely mentioned.
    const classifyAt = body.indexOf("deliver_argument.ts");
    const phase1At = body.indexOf("## Phases 1–2");
    expect(classifyAt).toBeGreaterThan(-1);
    expect(phase1At).toBeGreaterThan(-1);
    expect(classifyAt).toBeLessThan(phase1At);
  });

  test("the SKILL states the refusal AND that the design phase is not entered", () => {
    const body = operative().toLowerCase();
    expect(body).toContain("refuse");
    // The second half — the one the module mutation-verifies — must be stated,
    // not left implicit. A refusal that still brainstormed would satisfy a
    // prose pin that only looked for the word "refuse".
    expect(body).toMatch(/do not enter the design phase|never falls? through/);
  });

  test("the SKILL names BOTH plausible intents, so new work is not stranded", () => {
    const body = operative().toLowerCase();
    expect(body).toContain("no plan file");
    expect(body).toMatch(/start new work|meant to start/);
  });

  test("the SKILL names the union grammar and rules out a private pattern", () => {
    const body = operative();
    expect(body).toContain("M_<epic-key>");
    expect(body).toMatch(/short-ULID/i);
    expect(body).toContain("M\\d+");
  });

  // NON-VACUITY — the argument-hint alone must not satisfy any of the above.
  // It is one line and it ADVERTISES the capability; the body has to carry it.
  test("NON-VACUITY: the argument-hint line alone does not satisfy these pins", () => {
    const hintOnly =
      operative()
        .split("\n")
        .find((l) => l.startsWith("argument-hint:")) ?? "";
    expect(hintOnly).not.toBe("");
    expect(hintOnly).not.toContain("deliver_argument.ts");
    expect(hintOnly.toLowerCase()).not.toContain("refuse");
    expect(hintOnly.toLowerCase()).not.toContain("no plan file");
  });

  test("the non-tty refusal still covers every kind — no identity carve-out", () => {
    const body = operative().toLowerCase();
    expect(body).toMatch(/no carve-?out/);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-497.7 — the tty default is FAIL-SAFE, derived from the process.
//
// Audit finding: `stdinIsTty` defaulted to `true`, so a caller that forgot the
// flag got full interactive resolution under `claude -p` — the exact shape the
// non-tty refusal exists to stop. The safe value was the opt-in and the unsafe
// one was the default, and the module exported no way to compute it.
//
// Now derived: omitting the flag gives you the process's real answer.
// ---------------------------------------------------------------------------

describe("AC-STE-497.7 — omitting stdinIsTty is SAFE, not permissive", () => {
  // `bun test` runs non-tty, so an OMITTED flag must refuse here. If the
  // default were `true` again, this resolves instead and the test goes RED.
  test("with the flag OMITTED, every argument kind refuses under this non-tty runner", async () => {
    const { resolveDeliverArgument } = await import(
      "../adapters/_shared/src/deliver_argument"
    );
    for (const raw of ["add a dark mode toggle", "M129", "STE-492"]) {
      let threw: Error | null = null;
      try {
        resolveDeliverArgument({
          raw,
          probe: explodingProbe(),
          phases: explodingSink(),
        });
      } catch (e) {
        threw = e as Error;
      }
      expect({ raw, refused: threw !== null }).toEqual({ raw, refused: true });
      expect(threw!.message).toContain(REQUIRES_INPUT_REFUSED_MARKER);
    }
  });

  // ISOLATION — the derivation is a real read, not a hardcoded refusal. An
  // EXPLICIT true still resolves, so "omitting refuses" is not "always refuses".
  test("ISOLATION: an explicit stdinIsTty:true still resolves normally", async () => {
    const { resolveDeliverArgument } = await import(
      "../adapters/_shared/src/deliver_argument"
    );
    const routing = resolveDeliverArgument({
      raw: "add a dark mode toggle",
      probe: explodingProbe(),
      phases: recordingSink(),
      stdinIsTty: true,
    });
    expect(routing.kind).toBe("feature_request");
    expect(routing.entersDesignPhase).toBe(true);
  });

  // An explicit `false` must survive the `??` — `||` would have swallowed it.
  test("an explicit stdinIsTty:false still refuses, not overridden by derivation", async () => {
    const { resolveDeliverArgument } = await import(
      "../adapters/_shared/src/deliver_argument"
    );
    expect(() =>
      resolveDeliverArgument({
        raw: "M129",
        probe: explodingProbe(),
        phases: explodingSink(),
        stdinIsTty: false,
      }),
    ).toThrow();
  });

  test("the tty predicate is SOURCED from requires_input, not re-derived", async () => {
    const src = readFileSync(
      join(PLUGIN_ROOT, "adapters/_shared/src/deliver_argument.ts"),
      "utf-8",
    );
    expect(src).toContain("isStdinNonTty");
    // No private read of process.stdin — the predicate has one owner.
    expect(src).not.toContain("process.stdin");
  });
});

// ---------------------------------------------------------------------------
// README's Args column must MIRROR the skill's argument-hint.
//
// README.md itself states the rule: "The `Args` column mirrors each skill's
// `argument-hint:` frontmatter". Nothing enforced it, and this milestone
// staled it TWICE — /pr's cell still read `—` ("takes no arguments") after the
// skill gained `--draft`, and /deliver's still read the narrow hint after the
// grammar widened. Both were pinned green by tests asserting the OLD literal.
//
// Scoped to the two skills M129 changed. A general probe over every row is the
// right long-term fix and is filed in specs/notes/follow-ups.md — it would move
// the probe count, which no AC here authorises.
// ---------------------------------------------------------------------------

describe("README Args cells mirror the argument-hint for the skills M129 changed", () => {
  const README = join(PLUGIN_ROOT, "..", "..", "README.md");

  const hintOf = (skill: string): string => {
    const fm = readFileSync(
      join(PLUGIN_ROOT, "skills", skill, "SKILL.md"),
      "utf-8",
    );
    const m = fm.match(/^argument-hint:\s*(['"])(.+?)\1\s*$/m);
    expect(m, `no argument-hint in ${skill}`).not.toBeNull();
    return m![2]!;
  };

  const argsCellOf = (skill: string): string => {
    const row = readFileSync(README, "utf-8")
      .split("\n")
      .find((l) => l.startsWith(`| \`/${skill}\``));
    expect(row, `no README row for /${skill}`).toBeDefined();
    return (row as string).split("|").map((c) => c.trim())[3]!;
  };

  for (const skill of ["deliver", "pr"]) {
    test(`/${skill}'s Args cell is the backticked argument-hint, verbatim`, () => {
      const hint = hintOf(skill);
      expect({ skill, cell: argsCellOf(skill) }).toEqual({
        skill,
        cell: `\`${hint}\``,
      });
    });

    test(`/${skill}'s Args cell is not the takes-no-arguments marker`, () => {
      // `—` is defined in README as "a skill that takes no arguments". Both of
      // these skills take some, so the marker would be a false statement.
      expect({ skill, cell: argsCellOf(skill) }).not.toEqual({ skill, cell: "—" });
    });
  }

  // NON-VACUITY — the comparison must be able to fail.
  test("NON-VACUITY: the same comparison rejects a mismatched cell", () => {
    expect(`\`${hintOf("deliver")}\``).not.toBe("`[something else entirely]`");
  });
});
