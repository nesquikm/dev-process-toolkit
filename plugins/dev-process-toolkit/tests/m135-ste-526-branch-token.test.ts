// STE-526 — "The branch token is the whole milestone token" (M135).
//
// This FR changes NO production code. `buildBranchProposal` /
// `isCurrentBranchAcceptable` already render and match the full Epic-keyed
// milestone token symmetrically; what is wrong is the prose that tells a
// reader to supply the milestone *digits*. So:
//
//   - AC.1 / AC.2 / AC.3 are PROSE assertions (RED until the docs are fixed).
//   - AC.4 / AC.5 / AC.6 / AC.7 / AC.8 are REGRESSION guards over shipped
//     behaviour and pass today — deliberately, per AC.7.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  MILESTONE_BRANCH_TEMPLATE,
  TICKET_BRANCH_TEMPLATE,
  buildBranchProposal,
  canonicalBranchTemplate,
  isCurrentBranchAcceptable,
  type RunScope,
} from "../adapters/_shared/src/branch_proposal";

const PLUGIN_ROOT = join(__dirname, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");

/** Roots AC.3 scans. Named in every AC.3 assertion message. */
const SCAN_ROOTS = ["docs", "skills"] as const;

/**
 * The five statements AC.2 enumerates, as (plugin-relative file, anchor).
 * `skills/implement/SKILL.md` carries TWO of them on one physical line, so
 * each pin is scoped to a bounded window starting at its own anchor — the
 * two windows are ~740 chars apart at the measured commit and 300 chars
 * wide, so neither can be satisfied by the other's text.
 */
const STATEMENTS = [
  {
    id: "S1 docs/patterns.md — `{N}` placeholder gloss",
    file: "docs/patterns.md",
    kind: "between" as const,
    from: "`{N}`",
    fromAfter: "Placeholders:",
    to: "`{ticket-id}`",
  },
  {
    id: "S2 docs/implement-reference.md — Guard step 2, tracker-mode FR run",
    file: "docs/implement-reference.md",
    kind: "line" as const,
    anchor: "Tracker-mode FR run",
  },
  {
    id: "S3 docs/implement-reference.md — Proposal render step 5, canonicalBranchTemplate",
    file: "docs/implement-reference.md",
    kind: "line" as const,
    anchor: "Resolve the effective template via",
  },
  {
    id: "S4 skills/implement/SKILL.md — 0.b″ scope `milestoneNumber`",
    file: "skills/implement/SKILL.md",
    kind: "window" as const,
    anchor: "FR scopes carry optional",
    width: 300,
  },
  {
    id: "S5 skills/implement/SKILL.md — 0.b″ `{N}` resolution for FR-scoped runs",
    file: "skills/implement/SKILL.md",
    kind: "window" as const,
    anchor: "FR-scoped runs resolve `{N}`",
    width: 300,
  },
];

/** The enumerated surfaces (AC.2), plus the measured statement-line count per file. */
const ENUMERATED_SURFACES: Record<string, number> = {
  "docs/patterns.md": 1,
  "docs/implement-reference.md": 2,
  "skills/implement/SKILL.md": 1,
  // Added during implementation. The FR's own measurement missed this one: it
  // defines the same substitution but said milestone "number" rather than
  // "digits", so it matched neither the enumeration written from the tree nor
  // the detector built from that enumeration — a surface can be wrong in this
  // exact way while using none of the words the scan looks for.
  //
  // It was briefly "fixed" by wrapping the bullet across three lines so the
  // same-line detector could not see it, which would have kept this list
  // truthful by hiding a member. Rejected: AC.3 going red when a surface
  // appears is AC.3 WORKING, and the sanctioned response is to extend the
  // list, not to format prose so a scan will miss it.
  "docs/setup-tracker-mode.md": 1,
};

// ---------------------------------------------------------------------------
// AC.3 detection rule — stated here, once.
//
// A line is a *substitution-defining statement* iff it satisfies BOTH:
//
//   SUBJECT_RE  — it names the substitution itself: the `{N}` placeholder,
//                 or its scope-carried twin `milestoneNumber`.
//   DERIVATION_RE — it says WHAT VALUE goes in, in the vocabulary the two
//                 legal shapes are named by: bare `digits`, or the full
//                 `M_<epic-key>` token.
//
// The conjunction is what separates a DEFINITION ("`{N}` is the milestone
// digits") from a MENTION ("the template is `{type}/m{N}-{slug}`"). Subject
// alone over-matches every `## M{N}` / `FR-{N}` / `AC-{N}.{M}` heading in the
// tree; derivation alone catches `### FR-<digits>:` in the monolith guard.
//
// DERIVATION_RE deliberately accepts the POST-FIX vocabulary as well as the
// pre-fix one, so the found set is stable across this FR's edit: a statement
// rewritten to name both cases still contains `digits` AND `M_<epic-key>`,
// and one rewritten to name only the token is still found.
// ---------------------------------------------------------------------------
// KNOWN LIMITS, recorded rather than implied — the audit demonstrated each by
// planting a probe surface and watching this suite stay green:
//   1. "number" vocabulary with a numeric-only example and no `digits` —
//      byte-for-byte the wording that hid the fourth surface. Not closed:
//      widening DERIVATION_RE to `\bnumber\b` over-matches nearly every line
//      that mentions a milestone.
//   2. Naming the parameter instead of the placeholder (`canonicalBranchTemplate
//      ({ milestone })` — "`milestone` is the digits of …"), which carries no
//      subject token at all.
//   3. A statement wrapped so subject and derivation land on different lines,
//      in a file not already enumerated. (In an enumerated file the wrap is
//      caught — the per-file count drops.)
//   4. `<N>` vocabulary, which the tree also uses. This one was TRIED and
//      MEASURED: adding `<N>` to SUBJECT_RE pulls in ten unrelated surfaces
//      (gate-check probe rows, ship-milestone, deliver, spec-write,
//      spec-archive) that merely mention `M<N>` or `specs/plan/M<N>.md` on a
//      line that happens to also contain the word "digits". The subject token
//      `<N>` is too common in this tree to discriminate, so the widening was
//      reverted rather than shipped with ten carve-outs. The one statement it
//      would have caught — implement-reference's milestone-run RunScope line —
//      was corrected by hand instead, and is correct today while remaining
//      invisible to this scan.
// This detector is therefore a floor, not a proof. It closes the classes this
// tree contains; it does not close the class of all possible phrasings, and
// saying so here is cheaper than a future reader inferring completeness from
// a green run.
const SUBJECT_RE = /\{N\}|milestoneNumber/;
const DERIVATION_RE = /\bdigits\b|M_<epic-key>/;

function definesSubstitution(line: string): boolean {
  return SUBJECT_RE.test(line) && DERIVATION_RE.test(line);
}

function walkMarkdown(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walkMarkdown(p, out);
    else if (entry.endsWith(".md")) out.push(p);
  }
  return out;
}

function readSurface(pluginRelative: string): string {
  const path = join(PLUGIN_ROOT, ...pluginRelative.split("/"));
  if (!existsSync(path)) throw new Error(`surface not found: ${path}`);
  return readFileSync(path, "utf-8");
}

/** Scoped region for one enumerated statement. Throws loudly if its anchor vanished. */
function regionFor(stmt: (typeof STATEMENTS)[number]): string {
  const text = readSurface(stmt.file);
  if (stmt.kind === "line") {
    const line = text.split(/\r?\n/).find((l) => l.includes(stmt.anchor));
    if (line === undefined) {
      throw new Error(`${stmt.id}: anchor ${JSON.stringify(stmt.anchor)} not found in ${stmt.file}`);
    }
    return line;
  }
  if (stmt.kind === "window") {
    const at = text.indexOf(stmt.anchor);
    if (at < 0) {
      throw new Error(`${stmt.id}: anchor ${JSON.stringify(stmt.anchor)} not found in ${stmt.file}`);
    }
    return text.slice(at, at + stmt.width);
  }
  const gate = text.indexOf(stmt.fromAfter);
  if (gate < 0) {
    throw new Error(`${stmt.id}: gate ${JSON.stringify(stmt.fromAfter)} not found in ${stmt.file}`);
  }
  const start = text.indexOf(stmt.from, gate);
  if (start < 0) {
    throw new Error(`${stmt.id}: start ${JSON.stringify(stmt.from)} not found after gate in ${stmt.file}`);
  }
  const end = text.indexOf(stmt.to, start);
  if (end < 0) {
    throw new Error(`${stmt.id}: end ${JSON.stringify(stmt.to)} not found after start in ${stmt.file}`);
  }
  return text.slice(start, end);
}

function readFr(): string {
  const active = join(REPO_ROOT, "specs", "frs", "STE-526.md");
  const archived = join(REPO_ROOT, "specs", "frs", "archive", "STE-526.md");
  const path = existsSync(active) ? active : archived;
  if (!existsSync(path)) throw new Error(`STE-526 FR not found at ${active} or ${archived}`);
  return readFileSync(path, "utf-8");
}

// ---------------------------------------------------------------------------

describe("AC-STE-526.1 — every substitution-defining surface states BOTH cases", () => {
  const hits: Array<{ where: string; line: string }> = [];
  for (const root of SCAN_ROOTS) {
    for (const file of walkMarkdown(join(PLUGIN_ROOT, root))) {
      const rel = relative(PLUGIN_ROOT, file).split(sep).join("/");
      readFileSync(file, "utf-8")
        .split(/\r?\n/)
        .forEach((line, i) => {
          if (definesSubstitution(line)) hits.push({ where: `${rel}:${i + 1}`, line });
        });
    }
  }

  test("the scan found the surfaces at all (positive control)", () => {
    expect(hits.length).toBeGreaterThan(0);
  });

  for (const hit of hits) {
    test(`${hit.where} names the numeric case (bare digits)`, () => {
      expect(hit.line).toMatch(/\bdigits\b/);
    });

    // The violation AC.1 names: a surface saying only "digits".
    test(`${hit.where} names the Epic-keyed case (full M_<epic-key> token)`, () => {
      expect(hit.line).toContain("M_<epic-key>");
    });
  }
});

describe("AC-STE-526.2 — all five enumerated statements are updated together", () => {
  for (const stmt of STATEMENTS) {
    test(`${stmt.id} states the full M_<epic-key> token`, () => {
      expect(regionFor(stmt)).toContain("M_<epic-key>");
    });

    test(`${stmt.id} still states the bare-digits numeric case`, () => {
      expect(regionFor(stmt)).toMatch(/\bdigits\b/);
    });
  }

  test("the two skills/implement/SKILL.md windows do not overlap (each pin is independently falsifiable)", () => {
    const text = readSurface("skills/implement/SKILL.md");
    const s4 = STATEMENTS.find((s) => s.id.startsWith("S4"))!;
    const s5 = STATEMENTS.find((s) => s.id.startsWith("S5"))!;
    const a = text.indexOf(s4.anchor as string);
    const b = text.indexOf(s5.anchor as string);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(b).toBeGreaterThan(a);
    expect(b - a).toBeGreaterThan((s4 as { width: number }).width);
  });
});

describe("AC-STE-526.3 — the enumeration is derived, not hand-carried", () => {
  const scanned: string[] = [];
  const found: Record<string, number> = {};
  for (const root of SCAN_ROOTS) {
    const abs = join(PLUGIN_ROOT, root);
    for (const file of walkMarkdown(abs)) {
      const rel = relative(PLUGIN_ROOT, file).split(sep).join("/");
      scanned.push(rel);
      const n = readFileSync(file, "utf-8")
        .split(/\r?\n/)
        .filter(definesSubstitution).length;
      if (n > 0) found[rel] = n;
    }
  }

  const rootsLabel = SCAN_ROOTS.map((r) => `${relative(REPO_ROOT, PLUGIN_ROOT)}/${r}/**/*.md`).join(
    " + ",
  );

  test(`positive control: the scan actually read files under ${rootsLabel}`, () => {
    for (const root of SCAN_ROOTS) {
      expect(existsSync(join(PLUGIN_ROOT, root))).toBe(true);
    }
    // An empty-set search is a claim about the search before it is a claim
    // about the tree — prove the walker reached real files first.
    expect(scanned.length).toBeGreaterThan(20);
    expect(scanned).toContain("docs/patterns.md");
    expect(scanned).toContain("skills/implement/SKILL.md");
  });

  test("positive control: the detection rule accepts a definition and rejects a mention", () => {
    // Accepted — subject + derivation.
    expect(definesSubstitution("`{N}` (milestone digits), `{ticket-id}` (tracker ID)")).toBe(true);
    expect(
      definesSubstitution("optional `milestoneNumber` — the full `M_<epic-key>` token"),
    ).toBe(true);
    // Rejected — mention with no derivation (the `{N}` template is quoted, not defined).
    expect(definesSubstitution("| `branch_template` | e.g. `{type}/m{N}-{slug}` |")).toBe(false);
    // Rejected — derivation vocabulary with no substitution subject (the
    // monolith guard's `### FR-<digits>:` heading pattern).
    expect(
      definesSubstitution("the guard keys on the live-section pattern `### FR-<digits>:`"),
    ).toBe(false);
  });

  test(`the found surface set equals the AC.2 enumeration (roots: ${rootsLabel})`, () => {
    expect(Object.keys(found).sort()).toEqual(Object.keys(ENUMERATED_SURFACES).sort());
  });

  test(`the per-surface statement-line counts equal the enumeration (roots: ${rootsLabel})`, () => {
    expect(found).toEqual(ENUMERATED_SURFACES);
  });
});

// --- Behavioural pins. Green today: this FR changes no production code. -----

// Already kebab: `sanitizeSlug` STRIPS characters outside `[a-z0-9-]`, it does
// not convert spaces to hyphens, so "waiting states" would render "waitingstates".
const SLUG = "waiting-states";
const EPIC_MILESTONE = "M_GF_78";
const EPIC_BRANCH = "feat/m_gf_78-waiting-states";
/**
 * Spelled out literally, NOT computed from the digits: this is the exact
 * string the current (wrong) prose instructs a reader to produce.
 */
const DIGITS_DERIVED_BRANCH = "feat/m78-waiting-states";

const epicMilestoneScope: RunScope = { kind: "milestone", number: EPIC_MILESTONE };
const epicFrScope: RunScope = {
  kind: "fr-tracker",
  trackerId: "STE-526",
  milestoneNumber: EPIC_MILESTONE,
};

describe("AC-STE-526.4 — the full Epic-keyed token renders and is accepted", () => {
  test("canonicalBranchTemplate selects the milestone-keyed form for M_GF_78", () => {
    expect(canonicalBranchTemplate({ milestone: EPIC_MILESTONE })).toBe(MILESTONE_BRANCH_TEMPLATE);
    expect(MILESTONE_BRANCH_TEMPLATE).toBe("{type}/m{N}-{slug}");
  });

  test("buildBranchProposal with milestone M_GF_78 renders a branch carrying m_gf_78", () => {
    const rendered = buildBranchProposal({
      template: MILESTONE_BRANCH_TEMPLATE,
      type: "feat",
      slug: SLUG,
      milestone: EPIC_MILESTONE,
    });
    expect(rendered).toBe(EPIC_BRANCH);
    expect(rendered).toContain("m_gf_78");
  });

  test("isCurrentBranchAcceptable accepts that branch for a milestone scope of M_GF_78", () => {
    expect(isCurrentBranchAcceptable(EPIC_BRANCH, epicMilestoneScope)).toBe(true);
  });

  test("isCurrentBranchAcceptable accepts that branch for an FR scope bound to M_GF_78", () => {
    expect(isCurrentBranchAcceptable(EPIC_BRANCH, epicFrScope)).toBe(true);
  });
});

describe("AC-STE-526.5 — the digits-derived branch is REJECTED for an Epic-keyed scope", () => {
  test("the digits reading of M_GF_78 really does render feat/m78-waiting-states", () => {
    // Documents where the rejected literal comes from; the rejection below
    // does not compute it.
    expect(
      buildBranchProposal({
        template: MILESTONE_BRANCH_TEMPLATE,
        type: "feat",
        slug: SLUG,
        milestone: "78",
      }),
    ).toBe(DIGITS_DERIVED_BRANCH);
  });

  test("feat/m78-waiting-states is NOT acceptable for a milestone scope of M_GF_78", () => {
    expect(isCurrentBranchAcceptable(DIGITS_DERIVED_BRANCH, epicMilestoneScope)).toBe(false);
  });

  test("feat/m78-waiting-states is NOT acceptable for an FR scope bound to M_GF_78", () => {
    expect(isCurrentBranchAcceptable(DIGITS_DERIVED_BRANCH, epicFrScope)).toBe(false);
  });

  test("both sides asserted together: correct form accepted, prose-produced form refused", () => {
    expect(isCurrentBranchAcceptable(EPIC_BRANCH, epicMilestoneScope)).toBe(true);
    expect(isCurrentBranchAcceptable(DIGITS_DERIVED_BRANCH, epicMilestoneScope)).toBe(false);
  });
});

describe("AC-STE-526.6 — the numeric case is unchanged", () => {
  test("milestone 19 renders m19", () => {
    expect(
      buildBranchProposal({
        template: MILESTONE_BRANCH_TEMPLATE,
        type: "feat",
        slug: SLUG,
        milestone: "19",
      }),
    ).toBe("feat/m19-waiting-states");
  });

  test("feat/m19-waiting-states is accepted for a numeric milestone scope of 19", () => {
    expect(isCurrentBranchAcceptable("feat/m19-waiting-states", { kind: "milestone", number: "19" })).toBe(
      true,
    );
  });

  test("feat/m19-waiting-states is accepted for a numeric FR scope of 19", () => {
    expect(
      isCurrentBranchAcceptable("feat/m19-waiting-states", {
        kind: "fr-tracker",
        trackerId: "STE-526",
        milestoneNumber: "19",
      }),
    ).toBe(true);
  });

  test("word-boundary discipline still holds for the numeric case (m19 ≠ m191)", () => {
    expect(
      isCurrentBranchAcceptable("feat/m191-waiting-states", { kind: "milestone", number: "19" }),
    ).toBe(false);
  });
});

describe("AC-STE-526.7 — regression guard; the behaviour already passes today", () => {
  // Recorded plainly: this FR ships NO production-code change. The acceptance
  // matcher was extended for epic tokens when the union grammar landed, so
  // these assertions are green before the prose fix and must stay green after.
  test("the acceptance check already handles the full token (green before the prose fix)", () => {
    expect(isCurrentBranchAcceptable(EPIC_BRANCH, epicMilestoneScope)).toBe(true);
    expect(isCurrentBranchAcceptable(EPIC_BRANCH, epicFrScope)).toBe(true);
  });

  test("the FR's own AC.7 records that it already passes and that the correction is prose-only", () => {
    const ac7 = readFr()
      .split(/\r?\n/)
      .find((l) => l.includes("AC-STE-526.7"));
    expect(ac7).toBeDefined();
    expect(ac7!).toContain("already passes today");
    expect(ac7!).toContain("prose");
  });
});

describe("AC-STE-526.8 — word-boundary discipline holds for Epic-keyed branches", () => {
  test("a scope of M_GF_78 does NOT accept a branch carrying m_gf_781", () => {
    expect(isCurrentBranchAcceptable("feat/m_gf_781-waiting-states", epicMilestoneScope)).toBe(false);
    expect(isCurrentBranchAcceptable("feat/m_gf_781-waiting-states", epicFrScope)).toBe(false);
  });

  test("asserted alongside AC.4: the exact token still IS accepted (the relaxation guard is not vacuous)", () => {
    expect(isCurrentBranchAcceptable(EPIC_BRANCH, epicMilestoneScope)).toBe(true);
  });

  test("a prefixed carrier is not accepted either (dm_gf_78)", () => {
    expect(isCurrentBranchAcceptable("feat/dm_gf_78-waiting-states", epicMilestoneScope)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// AC-STE-526.9 and AC-STE-526.10 — added mid-flight, and initially shipped
// with NO assertion at all. The milestone-level review's traceability map
// marked both `status: missing`: the prose satisfied them, nothing pinned
// them, and the exact wrong readings they forbid would have returned green.
// An AC whose only witness is the prose it describes is not an AC.
// ═══════════════════════════════════════════════════════════════════════

/** The reading AC.9 exists to forbid, verbatim as it briefly shipped. */
const FORBIDDEN_LEAD = "the whole `milestone:` frontmatter token";
const FORBIDDEN_LEAD_SHORT = "the whole milestone token";

describe("AC-STE-526.9 — the fix must not introduce a second wrong reading", () => {
  for (const rel of Object.keys(ENUMERATED_SURFACES)) {
    test(`${rel} does not lead with the frontmatter-token reading`, () => {
      const src = readFileSync(join(PLUGIN_ROOT, rel), "utf-8");
      // Measured, not asserted by taste: for a NUMERIC milestone the whole
      // frontmatter token is `M135`, and that value selects the TICKET
      // template, renders `mM135`, and is rejected as a scope. A reader
      // keying on the leading noun phrase — which this FR says is a language
      // model — would supply it and silently get a different template.
      expect(src).not.toContain(FORBIDDEN_LEAD);
      expect(src).not.toContain(FORBIDDEN_LEAD_SHORT);
    });
  }

  test("the numeric trap the forbidden reading walks into is real, not asserted", () => {
    // The pin above is only worth having because the value it forbids breaks.
    // Asserting that here keeps the prohibition anchored to behaviour, so a
    // future reader cannot dismiss it as a style preference.
    expect(canonicalBranchTemplate({ milestone: "M135" })).toBe(TICKET_BRANCH_TEMPLATE);
    expect(canonicalBranchTemplate({ milestone: "135" })).toBe(MILESTONE_BRANCH_TEMPLATE);
    expect(isCurrentBranchAcceptable("feat/m135-x", { kind: "milestone", number: "M135" })).toBe(
      false,
    );
    expect(isCurrentBranchAcceptable("feat/m135-x", { kind: "milestone", number: "135" })).toBe(
      true,
    );
  });
});

describe("AC-STE-526.10 — the milestone-run half of the substitution is defined too", () => {
  const REL = "docs/implement-reference.md";

  function runScopeLine(): string {
    const lines = readFileSync(join(PLUGIN_ROOT, REL), "utf-8").split("\n");
    const hits = lines.filter((l) => /Milestone run \(`fallthrough`/.test(l));
    expect(hits.length, "expected exactly one milestone-run RunScope line").toBe(1);
    return hits[0]!;
  }

  test("it states both cases, not the numeric one alone", () => {
    // This line defined `number` from an `M<N>` argument as `"<N>"` — the
    // numeric-only reading, directly contradicting AC.4's own pin, which
    // passes the FULL token as `number`. It sits one line above an enumerated
    // surface and is invisible to AC.3's detector (KNOWN LIMIT 4), so nothing
    // else in this suite can see it.
    const line = runScopeLine();
    expect(line).toMatch(/\bdigits\b/);
    expect(line).toContain("M_<epic-key>");
  });

  test("AC.4's own scope shape is the one this line authorizes", () => {
    // The contradiction was concrete, not stylistic: AC.4 pins
    // `{kind:"milestone", number:"M_GF_78"}` as acceptable, which the old
    // wording did not permit. Asserting the behaviour beside the prose keeps
    // the two from drifting apart again.
    expect(
      isCurrentBranchAcceptable("fix/m_gf_78-waiting", {
        kind: "milestone",
        number: "M_GF_78",
      }),
    ).toBe(true);
  });
});
