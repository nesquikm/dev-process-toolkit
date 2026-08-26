// M134 / STE-520 — "Every spawned worker carries a name, on both paths".
//
// THE MEASUREMENT THIS FR RESTS ON. `skills/deliver/SKILL.md`'s Phase 3 step 1
// says `/deliver` "only hands it the kickoff task text and the milestone
// identity", and `docs/deliver-reference.md` says it "hands it exactly two
// things". STE-519 put a `remote_control` field in the pre-spawn decision
// record; nothing carries that field to the spawn, and the fresh-idea path has
// no record at all. So a change that reached only the confirm gate would name
// workers on the resume path and leave every fresh run spawning an unnamed,
// unbridged worker — the one-path-and-not-its-sibling shape this repo keeps
// shipping.
//
// WHAT IS UNDER TEST, and where each half lives:
//
//     skills/deliver/SKILL.md              ← the operative surface (AC.1–.11)
//     docs/deliver-reference.md            ← the sibling surface (AC.14)
//     adapters/_shared/src/deliver_decision.ts   ← the fallback (AC.11/.12/.13)
//     adapters/_shared/src/deliver_worker_name.ts ← the derivation, unchanged
//     .claude-plugin/*.json                ← no version floor (AC.8)
//
// THE CONTRACT THESE LEGS PIN, stated once so the implementer does not guess:
//
//   * TEN PROSE CLAUSES. AC.1, .2, .4, .5, .6, .7, .8, .9, .10 and .11 each
//     land as ONE anchored line on `skills/deliver/SKILL.md`, which in this
//     repo's markdown is one paragraph — the surfaces write paragraphs as
//     single lines, so a clause split across two of them will not satisfy its
//     vector. Every vector below was checked against a natural paragraph
//     before it was written; none of them needs a sentence contorted to pass.
//     Cite by MECHANISM, never by ticket id: `m129-ste-493` pins deliver's
//     STE-token count at zero and an `STE-520` written into the surface reds it.
//
//   * FIVE OF THOSE CLAUSES ARE ALSO OWED BY THE REFERENCE (AC.14): .2, .6,
//     .7, .9, .11. Parity is mutation-verified in BOTH directions — deleting
//     the clause from either surface reds that surface while the other stays
//     green, so the red is attributable to the surface that drifted.
//
//   * THE FALLBACK IS CODE (AC.11/.12/.13). `decideDelivery` today calls
//     `workerRemoteControlName` unguarded, so a repository whose basename the
//     grammar rejects REFUSES THE WHOLE RECORD before the gate the operator
//     would have used to drop the bridge — a naming problem halting the run
//     hardest, the exact inversion of this milestone's posture. It must instead
//     render `remote_control: none`, keep going, and carry ONE ADVISORY ROW
//     that names WHICH RULE broke.
//
//     WHERE THE ADVISORY ROW GOES: in the bytes `decideDelivery` returns, with
//     the record. That output IS the gate — the skill pastes it verbatim — so
//     an advisory the operator never sees is not an advisory. A row is any line
//     carrying the word "advisory"; exactly one such line, and none at all on a
//     run whose name derived cleanly.
//
//     WHICH RULE, and the vocabulary each advisory must and must not use — the
//     shipped module reports the leading-character case and the
//     nothing-left-after-sanitizing case with the SAME sentence today, so the
//     implementer has to tell them apart:
//
//       over the cap        — say `cap` / `no room` / `too long` / `32`.
//                             Do NOT say leading/begins-with, nothing/empty.
//       leading character   — say `leading` / `begins with` / `first character`.
//                             Do NOT say cap/32/no-room, nothing/empty.
//       nothing left        — say `nothing` / `empty` / `blank`.
//                             Do NOT say cap/32/no-room, leading/begins-with.
//
//     (The shipped envelope's "sanitizing cannot add one" tail is safe in all
//     three — `sanitiz` is in none of the vocabularies.)
//
//   * THE CATCH IS NARROW (AC.13), and narrowness is proved by MUTATION, not
//     by reading the source: a `WorkerNameRefusedError` injected at that call
//     site degrades, and a plain `Error` injected at the SAME site propagates
//     unchanged. Catching by site rather than by type passes the first leg and
//     reds the second — which is the fail-open shape arriving one AC after the
//     guard tightened to close it.
//
//   * BOTH SIDES, ALWAYS (AC.12). This repository's own basename is legal, so
//     a one-sided pin passes here forever. Every fallback leg is driven by an
//     explicit fixture root whose basename is off-grammar, paired with a
//     derivable control.
//
// IDIOMS ARE BORROWED, NOT INVENTED: the clause-vector / mutation machinery is
// `m134-ste-519-remote-control-field.test.ts`'s (whose `clauseVector` grades the
// BEST SINGLE anchored line — that property is kept), and the fixture tree is
// the same `m133-ste-514` shape.

import { afterAll, describe, expect, mock, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { decideDelivery } from "../adapters/_shared/src/deliver_decision";
import * as workerNameModule from "../adapters/_shared/src/deliver_worker_name";
import {
  WorkerNameRefusedError,
  workerRemoteControlName,
} from "../adapters/_shared/src/deliver_worker_name";
import { verifyResumeGateRender } from "../adapters/_shared/src/resume_gate_render";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");

const DELIVER_SKILL = join(PLUGIN_ROOT, "skills", "deliver", "SKILL.md");
const DELIVER_REFERENCE = join(PLUGIN_ROOT, "docs", "deliver-reference.md");
const PLUGIN_MANIFEST = join(PLUGIN_ROOT, ".claude-plugin", "plugin.json");
const MARKETPLACE_MANIFEST = join(
  REPO_ROOT,
  ".claude-plugin",
  "marketplace.json",
);

const SKILL_LABEL = "skills/deliver/SKILL.md";
const REFERENCE_LABEL = "docs/deliver-reference.md";

/** The module the fallback's call site reaches, spelled once for `mock.module`. */
const WORKER_NAME_MODULE = "../adapters/_shared/src/deliver_worker_name";

/** The real exports, captured BEFORE any mock replaces the namespace. */
const ACTUAL_WORKER_NAME = { ...workerNameModule };

const read = (p: string): string => readFileSync(p, "utf-8");

// ===========================================================================
// Fixtures.
//
// FOUR trees, because the fallback has three distinct causes and each needs a
// control. Each is built once and never mutated, so these legs do not change
// verdict as this repo's own milestones ship.
// ===========================================================================

const FIXTURE_MILESTONE = "M900";
const FIXTURE_FR = "STE-900";

/**
 * An FR identity whose sanitized form is 31 characters — one more than the
 * longest identity a 32-character name can carry alongside even a one-character
 * repository segment. It is a real tracker ref (`^[A-Z][A-Z0-9]*-[0-9]+$`), not
 * a malformed token, so the run reaches the name builder rather than being
 * refused upstream as prose.
 */
const OVER_CAP_FR = "LONGTEAMKEYFORTESTINGX-12345678";

function writeFixtureTree(root: string, extraFrs: readonly string[]): string {
  mkdirSync(join(root, "specs", "plan"), { recursive: true });
  mkdirSync(join(root, "specs", "frs"), { recursive: true });
  writeFileSync(
    join(root, "CLAUDE.md"),
    ["# Fixture", "", "## Orchestration", "", "default_effort: high", "merge_policy: offer", ""].join(
      "\n",
    ),
  );
  writeFileSync(
    join(root, "specs", "plan", `${FIXTURE_MILESTONE}.md`),
    [
      "---",
      `milestone: ${FIXTURE_MILESTONE}`,
      "status: active",
      "shipped_in: null",
      "---",
      "",
      `# ${FIXTURE_MILESTONE} — fixture milestone`,
      "",
      "## Tasks",
      "",
      "- [ ] Build the thing",
      "",
    ].join("\n"),
  );
  for (const fr of [FIXTURE_FR, ...extraFrs]) {
    writeFileSync(
      join(root, "specs", "frs", `${fr}.md`),
      [
        "---",
        "title: Fixture FR",
        `milestone: ${FIXTURE_MILESTONE}`,
        "status: active",
        "archived_at: null",
        "tracker:",
        `  linear: ${fr}`,
        "created_at: 2026-08-25T00:00:00Z",
        "changelog_category: Added",
        "---",
        "",
        "# Fixture FR",
        "",
        "## Acceptance Criteria",
        "",
        `- AC-${fr}.1: it exists.`,
        "",
      ].join("\n"),
    );
  }
  return root;
}

/** A tree whose own basename is `name`, under a fresh temp parent. */
function fixtureNamed(name: string, extraFrs: readonly string[] = []): string {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), "ste520-")));
  const root = join(parent, name);
  mkdirSync(root, { recursive: true });
  return writeFixtureTree(root, extraFrs);
}

/** The control: a basename the grammar accepts, so the name derives in full. */
const DERIVABLE_ROOT = fixtureNamed("goodrepo");

/** Basename opens with a digit — the composed name is off-grammar. */
const LEADING_CHAR_ROOT = fixtureNamed("9lives");

/** Basename sanitizes away entirely — there is no repository segment left. */
const EMPTY_SEGMENT_ROOT = fixtureNamed("@@@");

/** Legal basename, but an identity that leaves no room for one. */
const OVER_CAP_ROOT = fixtureNamed("goodrepo", [OVER_CAP_FR]);

// ===========================================================================
// The three underivable rules, and the vocabulary that tells them apart.
// ===========================================================================

interface UnderivableCase {
  readonly rule: "over_cap" | "leading_character" | "nothing_left";
  readonly what: string;
  readonly root: string;
  readonly argument: string;
  /** The identity the name builder is handed for this run. */
  readonly identity: string;
  /** The advisory MUST speak this rule's vocabulary. */
  readonly says: RegExp;
}

const OVER_CAP_WORDS = /\bcap\b|\bno room\b|\btoo long\b|\b32\b|\blonger than\b|\bexceeds?\b/i;
const LEADING_WORDS = /\bleading\b|\bbegins? with\b|\bstarts? with\b|\bfirst character\b/i;
const NOTHING_WORDS = /\bnothing\b|\bempty\b|\bblank\b/i;

const RULE_WORDS: Record<UnderivableCase["rule"], RegExp> = {
  over_cap: OVER_CAP_WORDS,
  leading_character: LEADING_WORDS,
  nothing_left: NOTHING_WORDS,
};

/**
 * Which REMEDY each rule must prescribe — the half `RULE_WORDS` does not grade.
 *
 * Naming the rule and prescribing the fix are two different promises, and only
 * the first was pinned. `over_cap` is an IDENTITY fault: it fires on
 * `32 - identity.length - 1 < 1`, so the basename is irrelevant and its own
 * fixture is the perfectly legal `goodrepo`. The other two are BASENAME faults.
 * A REFACTOR pass found all three pointed at "rename the repository", which
 * sends the over-cap operator to rename a repository that was never at fault —
 * and every leg stayed green, because nothing read the remedy. This does.
 */
const RULE_REMEDIES: Record<UnderivableCase["rule"], { readonly must: RegExp; readonly mustNot: RegExp }> = {
  // An identity fault: shorten the identity. Renaming the repository is the WRONG file.
  over_cap: { must: /shorten the identity/i, mustNot: /rename the repos/i },
  // Basename faults: rename the repository.
  leading_character: { must: /rename the repos/i, mustNot: /shorten the identity/i },
  nothing_left: { must: /rename the repos/i, mustNot: /shorten the identity/i },
};

const UNDERIVABLE_CASES: readonly UnderivableCase[] = [
  {
    rule: "over_cap",
    what: "the identity leaves no room for a repository segment",
    root: OVER_CAP_ROOT,
    argument: OVER_CAP_FR,
    identity: OVER_CAP_FR,
    says: OVER_CAP_WORDS,
  },
  {
    rule: "leading_character",
    what: "the basename opens with a character outside the grammar",
    root: LEADING_CHAR_ROOT,
    argument: FIXTURE_MILESTONE,
    identity: FIXTURE_MILESTONE,
    says: LEADING_WORDS,
  },
  {
    rule: "nothing_left",
    what: "the basename sanitizes away to nothing",
    root: EMPTY_SEGMENT_ROOT,
    argument: FIXTURE_MILESTONE,
    identity: FIXTURE_MILESTONE,
    says: NOTHING_WORDS,
  },
];

/** Every line of `text` that reports an advisory. */
function advisoryRows(text: string): string[] {
  return text.split("\n").filter((line) => /advisor/i.test(line));
}

/** The record's `remote_control` value, or `null` when the field is absent. */
function remoteControlValue(text: string): string | null {
  const line = text.split("\n").find((raw) => raw.startsWith("remote_control:"));
  return line === undefined ? null : line.slice("remote_control:".length).trim();
}

/** What `decideDelivery` did: the value, the advisories, and whether it refused. */
async function deliverOutcome(
  argument: string,
  projectRoot: string,
): Promise<{
  refused: string;
  remote: string | null;
  advisories: string[];
  text: string;
}> {
  try {
    const text = await decideDelivery({ argument, projectRoot });
    return {
      refused: "",
      remote: remoteControlValue(text),
      advisories: advisoryRows(text),
      text,
    };
  } catch (error) {
    const refused = error instanceof Error ? error.message : String(error);
    return { refused, remote: null, advisories: [], text: "" };
  }
}

// ===========================================================================
// Fixture falsifiability — the three roots really are the three rules.
//
// A fallback leg driven by a fixture that was never underivable in the first
// place is a leg that cannot fail. Asserted against the SHIPPED derivation,
// before any of the fallback legs read it.
// ===========================================================================

describe("fixtures — each underivable root really does refuse, and the control does not", () => {
  test("the control derives a full name", () => {
    expect(
      workerRemoteControlName({
        repoRoot: DERIVABLE_ROOT,
        identity: FIXTURE_MILESTONE,
      }),
    ).toBe("goodrepo-m900");
  });

  for (const c of UNDERIVABLE_CASES) {
    test(`${c.rule} — the derivation refuses (${c.what})`, () => {
      let refusal: unknown = null;
      try {
        workerRemoteControlName({ repoRoot: c.root, identity: c.identity });
      } catch (error) {
        refusal = error;
      }
      expect({
        rule: c.rule,
        refused: refusal !== null,
        named: refusal instanceof WorkerNameRefusedError,
      }).toEqual({ rule: c.rule, refused: true, named: true });
    });
  }

  test("the three roots are three DIFFERENT roots", () => {
    const roots = [DERIVABLE_ROOT, LEADING_CHAR_ROOT, EMPTY_SEGMENT_ROOT, OVER_CAP_ROOT];
    expect(new Set(roots).size).toBe(roots.length);
  });
});

// ===========================================================================
// The clause machinery — borrowed from m134-ste-519, unchanged in behaviour.
// ===========================================================================

interface SurfaceClause {
  readonly id: string;
  readonly what: string;
  /** Identifies candidate lines. */
  readonly anchor: (line: string) => boolean;
  /** All of these must hold on ONE anchored line for the clause to be present. */
  readonly required: readonly { readonly name: string; readonly re: RegExp }[];
}

function anchoredLines(text: string, clause: SurfaceClause): string[] {
  return text.split("\n").filter((raw) => clause.anchor(raw));
}

/**
 * Which requirements a surface satisfies — the vector, for a readable diff.
 *
 * The contract is ONE anchored line carrying EVERY requirement. Grading each
 * requirement independently with `anchored.some(...)` would let a clause split
 * across two anchored paragraphs pass, which is weaker than the interface
 * promises. So the vector is reported for the BEST SINGLE line, and a clause
 * that never lands whole on one line shows the requirement it is missing rather
 * than borrowing it from a neighbour.
 */
function clauseVector(
  text: string,
  clause: SurfaceClause,
): Record<string, boolean> {
  const anchored = anchoredLines(text, clause);
  const out: Record<string, boolean> = { anchored: anchored.length > 0 };
  let best: string | null = null;
  let bestScore = -1;
  for (const raw of anchored) {
    const score = clause.required.filter((r) => r.re.test(raw)).length;
    if (score > bestScore) {
      bestScore = score;
      best = raw;
    }
  }
  for (const { name, re } of clause.required) {
    out[name] = best !== null && re.test(best);
  }
  return out;
}

/** The vector a satisfied clause produces: anchored, plus every requirement. */
function satisfiedVector(clause: SurfaceClause): Record<string, boolean> {
  const out: Record<string, boolean> = { anchored: true };
  for (const { name } of clause.required) out[name] = true;
  return out;
}

/** `text` with every line this clause anchors deleted — the mutation. */
function deleteClause(
  text: string,
  clause: SurfaceClause,
): { mutated: string; removed: number } {
  const lines = text.split("\n");
  const kept = lines.filter((raw) => !clause.anchor(raw));
  return { mutated: kept.join("\n"), removed: lines.length - kept.length };
}

// --- the clauses ------------------------------------------------------------

/** AC.1 — the resume path takes the name from the CONFIRMED record. */
const RESUME_HANDOFF_CLAUSE: SurfaceClause = {
  id: "AC.1",
  what: "the resume path hands the spawn the confirmed record's remote_control",
  anchor: (line) => /remote[-_ ]control/i.test(line) && /\bresum/i.test(line),
  required: [
    { name: "hands-the-spawning-skill", re: /\bhand/i },
    { name: "spawn", re: /spawn/i },
    { name: "from-the-confirmed-record", re: /\bconfirm/i },
    {
      name: "not-re-derived-at-the-spawn",
      re: /\b(not|never|rather than rederiving|rather than re-deriving)\b[^.]{0,80}re-?deriv/i,
    },
  ],
};

/** AC.2 — the fresh-idea path is named by the SAME derivation. */
const FRESH_HANDOFF_CLAUSE: SurfaceClause = {
  id: "AC.2",
  what: "the fresh-idea path hands the spawn a name derived the same way",
  anchor: (line) => /\bfresh\b/i.test(line) && /\bnam(e|es|ed|ing)\b/i.test(line),
  required: [
    { name: "spawn", re: /spawn/i },
    {
      name: "the-same-derivation",
      re: /\b(same)\b[^.]{0,60}\b(derivation|function|builder|module|rule)\b/i,
    },
    { name: "from-phase-2s-milestone", re: /Phase\s*2/i },
    { name: "never-unnamed", re: /\bnever\b[^.]{0,80}\bunnamed\b/i },
  ],
};

/** AC.4 — the bridge argument is opt-in, and silence changes no bytes. */
const OPT_IN_CLAUSE: SurfaceClause = {
  id: "AC.4",
  what: "the bridge argument is opt-in and a nameless launch line is unchanged",
  anchor: (line) => /opt-in/i.test(line) && /(bridge|argument)/i.test(line),
  required: [
    {
      name: "no-name-supplied",
      re: /\b(no name|without a name|supplies no name|names? nothing)\b/i,
    },
    { name: "byte-identical", re: /byte-identical/i },
    { name: "the-launch-line", re: /\b(launch line|invocation|command line)\b/i },
  ],
};

/** AC.5 — a record reading `none` spawns an unbridged worker and runs on. */
const NONE_SPAWNS_CLAUSE: SurfaceClause = {
  id: "AC.5",
  what: "`none` spawns a worker with no bridge and the run proceeds",
  anchor: (line) => /\bnone\b/i.test(line) && /bridge/i.test(line),
  required: [
    { name: "remote-control-field", re: /remote[-_ ]control/i },
    {
      name: "no-bridge",
      re: /\b(no bridge|without (a |the )?bridge|unbridged)\b/i,
    },
    { name: "the-run-proceeds", re: /\b(proceeds|continues|runs on)\b/i },
  ],
};

/** AC.6 — an argument the spawning skill cannot use DEGRADES, never halts. */
const UNSUPPORTED_ARGUMENT_CLAUSE: SurfaceClause = {
  id: "AC.6",
  what: "a spawning skill that does not understand the argument degrades",
  anchor: (line) =>
    /\b(understand|understands|recognize|recognizes|too old)\b/i.test(line) &&
    /(argument|name)/i.test(line),
  required: [
    { name: "unbridged", re: /\bunbridged\b/i },
    { name: "unnamed", re: /\bunnamed\b/i },
    { name: "the-run-proceeds", re: /\b(proceeds|continues|runs on)\b/i },
    { name: "exactly-one-advisory-row", re: /\bone advisory\b/i },
    { name: "never-a-halt", re: /\b(never a halt|not a halt|no halt|does not halt)\b/i },
  ],
};

/** AC.7 — the departure from the halt precedent, in the FR's own terms. */
const DEPARTURE_CLAUSE: SurfaceClause = {
  id: "AC.7",
  what: "fail closed there, degrade cleanly here — and why the two differ",
  anchor: (line) => /fail closed/i.test(line),
  required: [
    { name: "the-existing-halt", re: /\bhalt/i },
    { name: "a-safety-property", re: /\bsafety\b/i },
    { name: "the-visible-session-contract", re: /visible session/i },
    { name: "an-explicit-non-substitute", re: /\bsubstitute\b/i },
    { name: "naming-is-legibility", re: /legibilit/i },
    { name: "still-completes-the-ceremony", re: /\bceremony\b/i },
    { name: "degrade-cleanly-here", re: /\bdegrade/i },
  ],
};

/** AC.8 — no version floor, in either direction. */
const NO_VERSION_FLOOR_CLAUSE: SurfaceClause = {
  id: "AC.8",
  what: "neither plugin declares a version floor on the other",
  anchor: (line) => /\b(version floor|floor on|minimum version)\b/i.test(line),
  required: [
    { name: "neither-declares-one", re: /\b(neither|no)\b/i },
    {
      name: "useful-against-an-older-spawning-skill",
      re: /\b(useful|works|still works)\b/i,
    },
    { name: "and-useful-to-other-callers", re: /\bcallers?\b/i },
  ],
};

/** AC.9 — a hard exit before the session starts is retried once, unbridged. */
const HARD_EXIT_CLAUSE: SurfaceClause = {
  id: "AC.9",
  what: "a bridged launch that hard-exits is retried once without the bridge",
  anchor: (line) => /hard[- ]exits?\b/i.test(line),
  required: [
    {
      name: "before-the-session-starts",
      re: /\bbefore\b[^.]{0,40}\b(session|it)\b[^.]{0,20}\bstarts?\b/i,
    },
    { name: "retried-exactly-once", re: /\b(exactly once|once)\b/i },
    {
      name: "without-the-bridge-argument",
      re: /\bwithout the (bridge )?argument\b|\bunbridged\b/i,
    },
    { name: "the-run-proceeds", re: /\b(proceeds|continues|runs on)\b/i },
    { name: "one-advisory-row", re: /\bone advisory\b/i },
  ],
};

/** AC.10 — the two degradations are reported apart, with their own remedies. */
const DISTINGUISHABLE_CLAUSE: SurfaceClause = {
  id: "AC.10",
  what: "an unsupported argument and a refused one are reported distinguishably",
  anchor: (line) => /distinguishabl|told apart|apart from/i.test(line),
  required: [
    { name: "the-unsupported-argument", re: /\b(understand|recognize|too old)\w*\b/i },
    { name: "the-hard-exit", re: /hard[- ]exits?\b|\brefuses?\b/i },
    { name: "different-remedies", re: /remed/i },
    {
      name: "its-own-advisory-row",
      re: /\b(its own|separate|distinct|different)\b[^.]{0,40}\badvisor/i,
    },
  ],
};

/** AC.11 — an underivable name renders `none` and goes to the gate anyway. */
const UNDERIVABLE_NAME_CLAUSE: SurfaceClause = {
  id: "AC.11",
  what: "an underivable name renders `none`, proceeds to the gate, and advises",
  anchor: (line) => /deriv/i.test(line) && /\bnone\b/i.test(line),
  required: [
    { name: "proceeds-to-the-gate", re: /\bgate\b/i },
    { name: "the-run-continues", re: /\b(proceeds|continues|runs on)\b/i },
    {
      name: "never-refuses-for-this",
      re: /\b(never refuses|does not refuse|not a refusal|never a refusal)\b/i,
    },
    { name: "one-advisory-row", re: /\bone advisory\b/i },
    { name: "names-which-rule", re: /\brule\b/i },
  ],
};

/** The five clauses both surfaces owe (AC.14). */
const PARITY_CLAUSES: readonly SurfaceClause[] = [
  FRESH_HANDOFF_CLAUSE,
  UNSUPPORTED_ARGUMENT_CLAUSE,
  DEPARTURE_CLAUSE,
  HARD_EXIT_CLAUSE,
  UNDERIVABLE_NAME_CLAUSE,
];

/** Assert one clause lands whole on one line of `path`. */
function expectClause(label: string, path: string, clause: SurfaceClause): void {
  expect({ surface: label, ...clauseVector(read(path), clause) }).toEqual({
    surface: label,
    ...satisfiedVector(clause),
  });
}

// ===========================================================================
// AC.1 / AC.2 — the two hand-offs, asserted SEPARATELY.
//
// Asserting them together would let one satisfy both, which is the whole
// asymmetry this FR exists to close.
// ===========================================================================

describe("AC-STE-520.1 — the resume path hands the spawn the confirmed name", () => {
  test("the operative surface states it", () => {
    expectClause(SKILL_LABEL, DELIVER_SKILL, RESUME_HANDOFF_CLAUSE);
  });

  test("the measured sentence no longer says the spawn gets only two things", () => {
    // The subject of the measurement: Phase 3 step 1's "`/deliver` only hands
    // it the kickoff task text and the milestone identity". A surface that
    // added a clause elsewhere and left this sentence standing states both
    // things at once, and the reader following the numbered step is the one
    // who acts.
    const stale = read(DELIVER_SKILL)
      .split("\n")
      .filter((line) => /\bhands? it\b/i.test(line) && /kickoff task text/i.test(line))
      .filter((line) => !/remote[-_ ]control|\bname\b/i.test(line));
    expect(stale).toEqual([]);
  });
});

describe("AC-STE-520.2 — the fresh-idea path never spawns an unnamed worker", () => {
  test("the operative surface states it", () => {
    expectClause(SKILL_LABEL, DELIVER_SKILL, FRESH_HANDOFF_CLAUSE);
  });
});

// ===========================================================================
// AC.3 — AC.2's assertion is FALSIFIABLE: deleting the clause reds it.
//
// "A sentence asserting the fresh path is covered, with nothing reading that
// surface, would pass while the path silently stayed uncovered."
// ===========================================================================

describe("AC-STE-520.3 — the fresh-path clause is mutation-verified", () => {
  test("deleting it from the operative surface turns the assertion red", () => {
    const original = read(DELIVER_SKILL);

    // Pre-condition: green before the mutation. Without it, a surface that
    // never shipped the clause makes the mutation pass for the wrong reason.
    expect(clauseVector(original, FRESH_HANDOFF_CLAUSE)).toEqual(
      satisfiedVector(FRESH_HANDOFF_CLAUSE),
    );

    const { mutated, removed } = deleteClause(original, FRESH_HANDOFF_CLAUSE);
    // The mutation must APPLY: one that never landed reads as a pass.
    expect({ applied: removed > 0 }).toEqual({ applied: true });
    expect(clauseVector(mutated, FRESH_HANDOFF_CLAUSE)).not.toEqual(
      satisfiedVector(FRESH_HANDOFF_CLAUSE),
    );
  });

  test("the red is ATTRIBUTABLE — the resume clause survives the deletion", () => {
    // Isolation: the fresh clause's deletion must not be what carries the
    // resume clause, or a single paragraph could be satisfying both and the
    // asymmetry would be back with two green tests over it.
    const { mutated } = deleteClause(read(DELIVER_SKILL), FRESH_HANDOFF_CLAUSE);
    expect(clauseVector(mutated, RESUME_HANDOFF_CLAUSE)).toEqual(
      satisfiedVector(RESUME_HANDOFF_CLAUSE),
    );
  });

  test("and the reverse — deleting the resume clause leaves the fresh one whole", () => {
    const { mutated, removed } = deleteClause(
      read(DELIVER_SKILL),
      RESUME_HANDOFF_CLAUSE,
    );
    expect({ applied: removed > 0 }).toEqual({ applied: true });
    expect(clauseVector(mutated, FRESH_HANDOFF_CLAUSE)).toEqual(
      satisfiedVector(FRESH_HANDOFF_CLAUSE),
    );
  });
});

// ===========================================================================
// AC.4 / AC.5 — opt-in, and what `none` means at the spawn.
// ===========================================================================

describe("AC-STE-520.4 — the bridge argument is opt-in", () => {
  test("the operative surface states the byte-identity property", () => {
    expectClause(SKILL_LABEL, DELIVER_SKILL, OPT_IN_CLAUSE);
  });
});

describe("AC-STE-520.5 — a record reading `none` spawns an unbridged worker", () => {
  test("the operative surface states it", () => {
    expectClause(SKILL_LABEL, DELIVER_SKILL, NONE_SPAWNS_CLAUSE);
  });

  test("the token the surface promises is the token the record actually emits", async () => {
    // The clause above promises a behaviour for a record whose field reads
    // `none`. This is the half that checks such a record really exists and
    // carries that exact token: a surface saying `none` over a record emitting
    // `unbridged`, `null` or an empty field would satisfy the vector and send
    // the reader looking for a value nothing produces. The fallback path is the
    // one that produces it without an operator typing anything.
    const skillSaysNone = anchoredLines(read(DELIVER_SKILL), NONE_SPAWNS_CLAUSE)
      .some((line) => /`none`/.test(line));
    const outcome = await deliverOutcome(FIXTURE_MILESTONE, LEADING_CHAR_ROOT);
    expect({ skillSaysNone, emitted: outcome.remote }).toEqual({
      skillSaysNone: true,
      emitted: "none",
    });
  });
});

// ===========================================================================
// AC.6 / AC.7 / AC.9 / AC.10 — degrade, and say which degradation it was.
// ===========================================================================

describe("AC-STE-520.6 — an argument the spawning skill cannot use degrades", () => {
  test("the operative surface states it", () => {
    expectClause(SKILL_LABEL, DELIVER_SKILL, UNSUPPORTED_ARGUMENT_CLAUSE);
  });
});

describe("AC-STE-520.7 — the departure from the halt precedent is recorded", () => {
  test("the operative surface states it", () => {
    expectClause(SKILL_LABEL, DELIVER_SKILL, DEPARTURE_CLAUSE);
  });

  test("the halt it departs from is still there, unweakened", () => {
    // The other half: "fail closed there" is a claim about a rule that has to
    // still exist. A surface that recorded the departure and quietly softened
    // the pre-flight halt would satisfy the vector above and break what it
    // claims — the Agent/Task substitution prohibition is the load-bearing
    // sentence, and it is measured present today.
    const skill = read(DELIVER_SKILL);
    expect({
      halts: /HALT with the NFR-10 canonical shape/.test(skill),
      refusesTheSubstitute: /Never substitute the built-in Agent\/Task tool/.test(
        skill,
      ),
    }).toEqual({ halts: true, refusesTheSubstitute: true });
  });
});

describe("AC-STE-520.9 — a hard exit before the session starts is retried once", () => {
  test("the operative surface states it", () => {
    expectClause(SKILL_LABEL, DELIVER_SKILL, HARD_EXIT_CLAUSE);
  });

  test("the retry is bounded — the surface names one retry, never a loop", () => {
    const line = anchoredLines(read(DELIVER_SKILL), HARD_EXIT_CLAUSE).find((raw) =>
      /\bonce\b/i.test(raw),
    );
    expect({
      stated: typeof line === "string",
      unbounded: line === undefined ? true : /\buntil\b|\brepeat(edly)?\b|\bkeeps? retrying\b/i.test(line),
    }).toEqual({ stated: true, unbounded: false });
  });
});

describe("AC-STE-520.10 — the two degradations are reported distinguishably", () => {
  test("the operative surface states it", () => {
    expectClause(SKILL_LABEL, DELIVER_SKILL, DISTINGUISHABLE_CLAUSE);
  });

  test("they are two clauses, not one line doing double duty", () => {
    // Collapsing AC.6's condition and AC.9's into a single advisory is exactly
    // what AC.10 forbids, and a single paragraph anchoring both is how that
    // arrives in prose. The best line for each must be a DIFFERENT line.
    const skill = read(DELIVER_SKILL);
    const bestFor = (clause: SurfaceClause): string | null => {
      let best: string | null = null;
      let bestScore = -1;
      for (const raw of anchoredLines(skill, clause)) {
        const score = clause.required.filter((r) => r.re.test(raw)).length;
        if (score > bestScore) {
          bestScore = score;
          best = raw;
        }
      }
      return best;
    };
    const unsupported = bestFor(UNSUPPORTED_ARGUMENT_CLAUSE);
    expect({
      unsupportedPresent: typeof unsupported === "string",
      hardExitPresent: typeof bestFor(HARD_EXIT_CLAUSE) === "string",
      sameLine: unsupported !== null && unsupported === bestFor(HARD_EXIT_CLAUSE),
    }).toEqual({
      unsupportedPresent: true,
      hardExitPresent: true,
      sameLine: false,
    });
  });
});

// ===========================================================================
// AC.8 — no version floor, on either side.
// ===========================================================================

describe("AC-STE-520.8 — neither plugin declares a version floor on the other", () => {
  test("the operative surface states it", () => {
    expectClause(SKILL_LABEL, DELIVER_SKILL, NO_VERSION_FLOOR_CLAUSE);
  });

  test("and no manifest declares one — a floor would have to name the plugin", () => {
    // The structural half. Both manifests are measured free of any mention of
    // the spawning plugin today; a declared floor cannot be written without
    // naming it, so this reds the day one appears.
    for (const [label, path] of [
      ["plugin.json", PLUGIN_MANIFEST],
      ["marketplace.json", MARKETPLACE_MANIFEST],
    ] as const) {
      expect({ manifest: label, namesTheSpawningPlugin: /agent-toolkit/i.test(read(path)) }).toEqual(
        { manifest: label, namesTheSpawningPlugin: false },
      );
    }
  });
});

// ===========================================================================
// AC.11 — an underivable name degrades to `none` instead of refusing.
// ===========================================================================

describe("AC-STE-520.11 — an underivable name renders `none` and reaches the gate", () => {
  test("the operative surface states it", () => {
    expectClause(SKILL_LABEL, DELIVER_SKILL, UNDERIVABLE_NAME_CLAUSE);
  });

  for (const c of UNDERIVABLE_CASES) {
    test(`${c.rule} — the record renders \`none\` and does not refuse`, async () => {
      const outcome = await deliverOutcome(c.argument, c.root);
      expect({
        rule: c.rule,
        refused: outcome.refused,
        remote: outcome.remote,
      }).toEqual({ rule: c.rule, refused: "", remote: "none" });
    });

    test(`${c.rule} — exactly ONE advisory row reports it`, async () => {
      const outcome = await deliverOutcome(c.argument, c.root);
      expect({ rule: c.rule, rows: outcome.advisories.length }).toEqual({
        rule: c.rule,
        rows: 1,
      });
    });

    test(`${c.rule} — the advisory names WHICH RULE the basename broke`, async () => {
      // The operator cannot rename a repository whose fault they cannot
      // diagnose, so "could not derive a name" is not an answer. The advisory
      // must speak this rule's vocabulary and NEITHER of the other two's — the
      // shipped derivation reports the leading-character case and the
      // nothing-left case with the same sentence today, which is precisely the
      // collapse this leg refuses.
      const outcome = await deliverOutcome(c.argument, c.root);
      const row = outcome.advisories.join(" ");
      const spoken: Record<string, boolean> = {};
      for (const [rule, words] of Object.entries(RULE_WORDS)) {
        spoken[rule] = words.test(row);
      }
      const expected: Record<string, boolean> = {};
      for (const rule of Object.keys(RULE_WORDS)) expected[rule] = rule === c.rule;
      expect({ rule: c.rule, ...spoken }).toEqual({ rule: c.rule, ...expected });
    });

    test(`AC-STE-520.11 — ${c.rule}: the advisory prescribes the RIGHT remedy`, async () => {
      // Naming the rule is half the promise; naming the FIX is the other half,
      // and it was the half that shipped wrong. The `mustNot` side is what
      // makes this falsifiable: re-pointing over_cap at a rename trips it.
      const outcome = await deliverOutcome(c.argument, c.root);
      const row = outcome.advisories.join("\n");
      const { must, mustNot } = RULE_REMEDIES[c.rule];
      expect({ rule: c.rule, prescribes: must.test(row), misdirects: mustNot.test(row) }).toEqual({
        rule: c.rule,
        prescribes: true,
        misdirects: false,
      });
    });

    test(`${c.rule} — the run PROCEEDS TO THE GATE (the render still grades clean)`, async () => {
      // "Proceeds to the gate" is not a mood: the gate is graded before it is
      // shown, so a degraded record that the render predicate rejects has not
      // reached any gate at all.
      const outcome = await deliverOutcome(c.argument, c.root);
      const rendered = [
        `Before anything is spawned, here is the delivery decision for ${c.argument}:`,
        "",
        outcome.text,
        "",
        "Confirm this chain, edit it, or abort.",
      ].join("\n");
      expect({
        rule: c.rule,
        verdict: verifyResumeGateRender(rendered, outcome.text),
      }).toEqual({ rule: c.rule, verdict: { ok: true, reasons: [] } });
    });
  }

  test("the three advisories are three DIFFERENT sentences", async () => {
    // Pairwise distinctness, over and above the vocabulary legs: one generic
    // advisory reused for all three rules satisfies nothing an operator can
    // act on.
    const outcomes = await Promise.all(
      UNDERIVABLE_CASES.map((c) => deliverOutcome(c.argument, c.root)),
    );
    const rows = outcomes.map((o) => o.advisories.join(" ").trim());
    expect({
      rows: rows.length,
      nonEmpty: rows.every((row) => row.length > 0),
      distinct: new Set(rows).size,
    }).toEqual({
      rows: UNDERIVABLE_CASES.length,
      nonEmpty: true,
      distinct: UNDERIVABLE_CASES.length,
    });
  });
});

// ===========================================================================
// AC.12 — BOTH SIDES. A derivable name renders in full; an underivable one
// yields `none`, the advisory, and a run that continues.
//
// This repository's own basename is legal, so a one-sided pin passes here
// forever — a test that cannot fail. The pair is asserted in ONE expectation
// so neither half can be dropped without the other going red with it.
// ===========================================================================

describe("AC-STE-520.12 — the derivable and underivable sides are pinned together", () => {
  test("a derivable name renders in FULL, with no advisory at all", async () => {
    const outcome = await deliverOutcome(FIXTURE_MILESTONE, DERIVABLE_ROOT);
    expect({
      refused: outcome.refused,
      remote: outcome.remote,
      advisories: outcome.advisories.length,
    }).toEqual({
      refused: "",
      remote: workerRemoteControlName({
        repoRoot: DERIVABLE_ROOT,
        identity: FIXTURE_MILESTONE,
      }),
      advisories: 0,
    });
  });

  test("both sides, in one expectation", async () => {
    const derivable = await deliverOutcome(FIXTURE_MILESTONE, DERIVABLE_ROOT);
    const underivable = await deliverOutcome(
      FIXTURE_MILESTONE,
      LEADING_CHAR_ROOT,
    );
    expect({
      derivableRemote: derivable.remote,
      derivableAdvisories: derivable.advisories.length,
      derivableRefused: derivable.refused === "",
      underivableRemote: underivable.remote,
      underivableAdvisories: underivable.advisories.length,
      underivableRefused: underivable.refused === "",
    }).toEqual({
      derivableRemote: "goodrepo-m900",
      derivableAdvisories: 0,
      derivableRefused: true,
      underivableRemote: "none",
      underivableAdvisories: 1,
      underivableRefused: true,
    });
  });

  test("the two sides really are different runs of the same command", () => {
    // Isolation: the ONLY difference between them is the repository basename.
    // If the fallback were keyed on anything else, this pairing would not be
    // the discriminator it claims to be.
    expect({
      sameArgument: true,
      derivableBase: DERIVABLE_ROOT.split("/").pop(),
      underivableBase: LEADING_CHAR_ROOT.split("/").pop(),
    }).toEqual({
      sameArgument: true,
      derivableBase: "goodrepo",
      underivableBase: "9lives",
    });
  });
});

// ===========================================================================
// AC.14 — sibling-surface parity for AC.2, AC.6, AC.7, AC.9 and AC.11.
//
// Each clause is asserted present on BOTH surfaces and mutation-verified in
// BOTH directions: deleting it from either one reds that surface while the
// other stays green, so the red names the surface that drifted.
// ===========================================================================

const PARITY_SURFACES = [
  { label: SKILL_LABEL, path: DELIVER_SKILL },
  { label: REFERENCE_LABEL, path: DELIVER_REFERENCE },
] as const;

describe("AC-STE-520.14 — both surfaces carry all five clauses", () => {
  for (const clause of PARITY_CLAUSES) {
    test(`${clause.id} — ${clause.what}, on both surfaces`, () => {
      expect(
        PARITY_SURFACES.map((s) => ({
          surface: s.label,
          ...clauseVector(read(s.path), clause),
        })),
      ).toEqual(
        PARITY_SURFACES.map((s) => ({
          surface: s.label,
          ...satisfiedVector(clause),
        })),
      );
    });
  }

  test("the reference no longer says the spawn is handed exactly two things", () => {
    // The reference's own measured sentence: "`/deliver` hands it exactly two
    // things — the kickoff task text and the milestone identity". A count that
    // stayed at two while the skill grew a third is the drift this AC guards.
    const stale = read(DELIVER_REFERENCE)
      .split("\n")
      .filter((line) => /\bhands? it\b/i.test(line) && /\bexactly two\b/i.test(line));
    expect(stale).toEqual([]);
  });
});

describe("AC-STE-520.14 — mutation-verified in both directions", () => {
  for (const clause of PARITY_CLAUSES) {
    for (const target of PARITY_SURFACES) {
      test(`${clause.id} — deleting it from ${target.label} reds that surface alone`, () => {
        const texts = new Map(
          PARITY_SURFACES.map((s) => [s.label, read(s.path)] as const),
        );

        // Pre-condition: both green before the mutation.
        for (const s of PARITY_SURFACES) {
          expect({
            surface: s.label,
            ...clauseVector(texts.get(s.label)!, clause),
          }).toEqual({ surface: s.label, ...satisfiedVector(clause) });
        }

        const { mutated, removed } = deleteClause(texts.get(target.label)!, clause);
        expect({ surface: target.label, applied: removed > 0 }).toEqual({
          surface: target.label,
          applied: true,
        });
        expect({
          surface: target.label,
          ...clauseVector(mutated, clause),
        }).not.toEqual({ surface: target.label, ...satisfiedVector(clause) });

        // And the sibling stays green, so the red is attributable.
        const other = PARITY_SURFACES.find((s) => s.label !== target.label)!;
        expect({
          surface: other.label,
          ...clauseVector(texts.get(other.label)!, clause),
        }).toEqual({ surface: other.label, ...satisfiedVector(clause) });
      });
    }
  }
});

// ===========================================================================
// AC.13 — the catch is NARROW, proved by MUTATION.
//
// LAST IN THE FILE ON PURPOSE. These legs replace the derivation module in the
// registry, and a mock that outlived its describe would silently change the
// verdict of every leg after it.
//
// Both legs run against the DERIVABLE fixture, so the only reason a fallback
// can fire is the injected error — not the tree.
// ===========================================================================

/** The message no `catch` may ever swallow. */
const SENTINEL = "ste520-sentinel: not a worker-name refusal";

function mockWorkerName(throwing: () => never): void {
  mock.module(WORKER_NAME_MODULE, () => ({
    ...ACTUAL_WORKER_NAME,
    workerRemoteControlName: throwing,
  }));
}

function restoreWorkerName(): void {
  mock.module(WORKER_NAME_MODULE, () => ({ ...ACTUAL_WORKER_NAME }));
}

describe("AC-STE-520.13 — only the underivable-name refusal is caught", () => {
  afterAll(() => {
    restoreWorkerName();
  });

  test("a WorkerNameRefusedError from that call site DEGRADES (the control)", async () => {
    // The control, and the proof the injection reaches the real call site: a
    // leg that could not reach it would make the narrowness leg below pass for
    // the wrong reason.
    mockWorkerName(() => {
      throw new WorkerNameRefusedError(
        [
          "Refusing: to name a worker: nothing is left of the repository basename after sanitizing.",
          "Remedy: spawn from a repository root whose basename survives sanitizing.",
          "Context: injected by the narrowness control.",
        ].join("\n"),
      );
    });
    const outcome = await deliverOutcome(FIXTURE_MILESTONE, DERIVABLE_ROOT);
    expect({
      refused: outcome.refused,
      remote: outcome.remote,
      advisories: outcome.advisories.length,
    }).toEqual({ refused: "", remote: "none", advisories: 1 });
    restoreWorkerName();
  });

  test("a DIFFERENT error from the SAME call site propagates unchanged", async () => {
    // The mutation. A `catch` written around the call site rather than around
    // the error TYPE passes the control above and reds here — and that widened
    // catch is the fail-open shape this milestone exists to prevent, arriving
    // one AC after the guard tightened to close it.
    mockWorkerName(() => {
      throw new Error(SENTINEL);
    });
    const outcome = await deliverOutcome(FIXTURE_MILESTONE, DERIVABLE_ROOT);
    expect({
      propagated: outcome.refused.includes(SENTINEL),
      swallowedIntoNone: outcome.remote === "none",
      advisories: outcome.advisories.length,
    }).toEqual({ propagated: true, swallowedIntoNone: false, advisories: 0 });
    restoreWorkerName();
  });

  test("with the mock lifted, the derivable run is unchanged", async () => {
    // The mocks are restored, not merely abandoned: a registry left patched
    // would change the verdict of anything that ran after it.
    restoreWorkerName();
    const outcome = await deliverOutcome(FIXTURE_MILESTONE, DERIVABLE_ROOT);
    expect({ refused: outcome.refused, remote: outcome.remote }).toEqual({
      refused: "",
      remote: "goodrepo-m900",
    });
  });
});
