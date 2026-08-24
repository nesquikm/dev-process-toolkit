// M130 / STE-502 — "Every /deliver surface states FR scope, not only the
// reference".
//
// SUBJECTS (prose surfaces, plus their AGREEMENT):
//   * plugins/dev-process-toolkit/skills/deliver/SKILL.md   — the OPERATIVE surface
//   * plugins/dev-process-toolkit/docs/deliver-reference.md — the file the skill
//     itself marks "not required reading"
//   * plugins/dev-process-toolkit/docs/workflow-overview.md
//
// The behaviour these surfaces must now state (shipped in
// adapters/_shared/src/resume_classifier.ts by STE-499..501):
//
//   * An FR identity delivers THAT FR. Its milestone is resolved and carried,
//     but is not the unit of work.
//   * Other active FRs still bound to the milestone ⇒ the chain is
//     `/implement <FR-id>` then `/pr` — it stops at the PR.
//   * The FR is the LAST ACTIVE FR bound to its milestone ⇒ the chain extends:
//     `/implement <FR-id>` → `/spec-archive M<N>` → `/ship-milestone M<N>` →
//     `/pr`. `/spec-archive` is explicit because a single-FR `/implement` run
//     leaves `status: active` behind.
//
// PIN DISCIPLINE (this repo's accumulated findings — the FR is itself a guard
// against the failure mode in the first bullet):
//
//   * AC.2 IS THE MECHANISM, NOT AC.1 (FR Technical Design; M129's AC-STE-492.2
//     precedent). "Skill contains X" AND separately "reference contains X" is
//     exactly what AC.2 forbids: it passes when both surfaces carry a rule and
//     the rules DIFFER. So each surface's claim is EXTRACTED into a structured
//     value and the two values are compared against each other directly. A
//     comparator self-test (`FIXTURE_LAST_ACTIVE` vs `FIXTURE_ALWAYS`) proves
//     the comparison actually separates two surfaces that both carry a rule.
//
//   * AC.5 IS MUTATION-VERIFIED, NOT INSPECTED. The mutation is BUILT and RUN:
//     the FR-scope paragraphs are stripped out of the skill body and appended to
//     the reference body, and the AC.1 predicate is asserted to FAIL on the
//     mutated skill while still PASSING on the mutated reference — so the RED is
//     attributable to PLACEMENT, not to deletion. The mutation is also asserted
//     to have actually applied (M124: a mutation that never applied reads as a
//     pass).
//
//   * NO SINGLE-LITERAL PINS (M127/M126: /gate-check-style prose is LLM-rendered
//     and single-literal assertions drift). Every field of the claim vector is a
//     tolerant alternation over independent tokens, and AC.1 is the CONJUNCTION
//     of all of them — the four chain steps AND the last-active condition AND
//     the FR-scope claim AND the stop-at-PR branch — never one exact sentence.
//
//   * AC.3 IS A NEGATIVE ASSERTION, so it carries an isolation leg. A negative
//     that can never fire is vacuous, so the detector is proven to FIRE on the
//     sentence shipped on this tree today, and proven NOT to fire on a corrected
//     rewrite that still mentions the milestone frontmatter — i.e. it detects
//     the defect-describing CLAIM, not the vocabulary.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT = join(import.meta.dir, "..");

const DELIVER_SKILL = join(PLUGIN_ROOT, "skills", "deliver", "SKILL.md");
const DELIVER_REFERENCE = join(PLUGIN_ROOT, "docs", "deliver-reference.md");
const WORKFLOW_OVERVIEW = join(PLUGIN_ROOT, "docs", "workflow-overview.md");

const read = (p: string): string => readFileSync(p, "utf8");
const skill = (): string => read(DELIVER_SKILL);
const reference = (): string => read(DELIVER_REFERENCE);
const overview = (): string => read(WORKFLOW_OVERVIEW);

// NFR-1. Restated here rather than imported from
// tests/gate-check-active-plan-ship-ready.test.ts on purpose — a test file is
// not a module contract. Pinned as a TRIPWIRE: the FR states outright that
// line-cap pressure is not an acceptable defence for leaving the rule off the
// operative surface (M129 reproduced the defect at 119 lines of 358), so the
// edit is proven to FIT rather than argued about.
const SKILL_LINE_CAP = 358;

// ---------------------------------------------------------------------------
// Claim extraction — one structured value per surface
// ---------------------------------------------------------------------------

// Independent tokens. Each is an alternation so a reworded-but-equivalent
// sentence still scores; none of them is the whole predicate on its own.
const CUE = {
  frScoped:
    /\bFR[-\s]scoped\b|\bFR scope\b|delivers (?:only )?that FR\b|that FR alone\b|\bthe FR is the unit of work\b|\bnot the unit of work\b/i,
  implement: /\/implement\b/,
  pr: /\/pr\b/i,
  specArchive: /\/spec-archive\b/,
  shipMilestone: /\/ship-milestone\b/,
  // Deliberately NOT a bare `zero active FRs` — the shipped resume table's
  // `ship_ready` row reads "zero active FRs bound", which is a MILESTONE-state
  // claim, not the FR chain's auto-extend condition. Matching it would put the
  // wrong paragraph in the region: a perfect pin on a wrong subject is worthless
  // (feedback_falsifiability_limits). The classifier's own rationale wording
  // ("0 active FRs would remain once it lands") still scores.
  lastActive:
    /\blast active FR\b|\blast remaining active FR\b|\bno (?:other )?active FRs? (?:remain|are left)\b|\b(?:zero|0) active FRs? (?:would )?remain\b/i,
  alwaysExtend:
    /\balways extends?\b|\bextends? (?:for )?every FR\b|\bunconditionally extends?\b|\bregardless of (?:how many|whether|the count)\b/i,
  remainingBranch:
    /\bother active FRs?\b|\bremaining active FRs?\b|\bactive FRs? (?:still )?remain\b|\bsiblings? remain\b/i,
  deliver: /\/deliver\b/,
} as const;

type ExtendCondition = "last_active" | "always" | "both" | "absent";

interface FrScopeClaim {
  readonly frScoped: boolean;
  readonly namesImplement: boolean;
  readonly namesPr: boolean;
  readonly namesSpecArchive: boolean;
  readonly namesShipMilestone: boolean;
  readonly archiveBeforeShip: boolean;
  readonly extendCondition: ExtendCondition;
  readonly statesRemainingFrBranch: boolean;
  readonly supersededSameRoutingClaim: boolean;
}

/** Blank-line-separated blocks. Markdown tables stay one block, as intended. */
const paragraphs = (text: string): string[] =>
  text.split(/\n\s*\n/).filter((p) => p.trim() !== "");

/**
 * A paragraph belongs to the FR-scope region when it makes any FR-scope routing
 * claim at all. Used for BOTH the claim extraction and the AC.5 mutation, so
 * the mutation is guaranteed to empty the region it strips from.
 */
const isFrScopeParagraph = (p: string): boolean =>
  CUE.specArchive.test(p) ||
  CUE.frScoped.test(p) ||
  CUE.lastActive.test(p) ||
  CUE.alwaysExtend.test(p) ||
  // The non-last-active branch ("other active FRs remain ⇒ stop at the PR") is
  // half the rule, so the paragraph that states it belongs to the region — and
  // therefore also moves under the AC.5 mutation.
  CUE.remainingBranch.test(p);

const frScopeParagraphs = (text: string): string[] =>
  paragraphs(text).filter(isFrScopeParagraph);

/**
 * The superseded claim STE-502 AC.3 deletes: an FR identity resolving through
 * its milestone frontmatter to the SAME routing as its milestone. Matched per
 * sentence and as a CONJUNCTION of two independent halves — the frontmatter
 * resolution AND the same-routing conclusion — so a corrected rewrite that
 * still mentions the frontmatter (the milestone IS still resolved and carried)
 * does not trip it.
 */
const FRONTMATTER_ROUTE =
  /(?:resolv\w+|routes?)[^.]*\bmilestone\b[^.]*\bfrontmatter\b|\bfrontmatter\b[^.]*(?:resolv\w+|routes?)[^.]*\bmilestone\b/i;
const SAME_ROUTING =
  /\bsame routing\b|\bsame path\b|\bmilestone path above\b|\b(?:routes?|routed|handled|treated|delivered|behaves?)\s+(?:exactly\s+|just\s+)?(?:the\s+same|identically|as)\b|\bno different(?:ly)? (?:from|to|than)\b/i;

const sentences = (text: string): string[] =>
  text
    .split(/(?<=[.!?])\s+|\n/)
    .map((s) => s.trim())
    .filter((s) => s !== "");

const supersededSameRoutingSentences = (text: string): string[] =>
  sentences(text).filter((s) => FRONTMATTER_ROUTE.test(s) && SAME_ROUTING.test(s));

const hasSupersededSameRoutingClaim = (text: string): boolean =>
  supersededSameRoutingSentences(text).length > 0;

const extendCondition = (region: string): ExtendCondition => {
  const last = CUE.lastActive.test(region);
  const always = CUE.alwaysExtend.test(region);
  if (last && always) return "both";
  if (last) return "last_active";
  if (always) return "always";
  return "absent";
};

/**
 * `/spec-archive` precedes `/ship-milestone` — asserted INSIDE the one paragraph
 * that names both, never across the concatenated region: the shipped resume
 * table names `/ship-milestone` for milestone-scoped states, and ordering across
 * unrelated paragraphs would be a false RED about the wrong subject.
 */
const archiveBeforeShip = (region: string[]): boolean =>
  region.some((p) => {
    const a = p.indexOf("/spec-archive");
    const s = p.indexOf("/ship-milestone");
    return a !== -1 && s !== -1 && a < s;
  });

const frScopeClaim = (text: string): FrScopeClaim => {
  const region = frScopeParagraphs(text);
  const joined = region.join("\n\n");
  return {
    frScoped: CUE.frScoped.test(joined),
    namesImplement: CUE.implement.test(joined),
    namesPr: CUE.pr.test(joined),
    namesSpecArchive: CUE.specArchive.test(joined),
    namesShipMilestone: CUE.shipMilestone.test(joined),
    archiveBeforeShip: archiveBeforeShip(region),
    extendCondition: extendCondition(joined),
    statesRemainingFrBranch: CUE.remainingBranch.test(joined) && CUE.pr.test(joined),
    // Whole-file on purpose: the superseded claim lives in the argument-
    // classification prose, which is NOT part of the FR-scope region. A surface
    // still asserting it disagrees with the surface that corrected it.
    supersededSameRoutingClaim: hasSupersededSameRoutingClaim(text),
  };
};

/** The one value both operative surfaces must produce. */
const EXPECTED_CLAIM: FrScopeClaim = {
  frScoped: true,
  namesImplement: true,
  namesPr: true,
  namesSpecArchive: true,
  namesShipMilestone: true,
  archiveBeforeShip: true,
  extendCondition: "last_active",
  statesRemainingFrBranch: true,
  supersededSameRoutingClaim: false,
};

// ---------------------------------------------------------------------------
// Synthetic fixtures — used ONLY to prove the extractor/comparator are not
// vacuous. Never read from disk, so they cannot drift with the real files.
// ---------------------------------------------------------------------------

const FIXTURE_LAST_ACTIVE = `## FR-scoped resume

An FR identity delivers that FR. Its milestone is resolved and carried, but the
milestone is not the unit of work.

When other active FRs remain bound to the milestone, the chain is
\`/implement <FR-id>\` then \`/pr\` — it stops at the PR, because the ship
ceremony belongs to the run that closes the milestone.

When the FR is the last active FR bound to its milestone, the chain extends to
\`/implement <FR-id>\` → \`/spec-archive M<N>\` → \`/ship-milestone M<N>\` →
\`/pr\`. \`/spec-archive\` is explicit because a single-FR \`/implement\` run
leaves \`status: active\` behind.
`;

// Same FR scope, same four chain steps, same stop-at-PR branch — and a DIFFERENT
// rule. This is the case AC.2 exists to catch and that a per-surface presence
// check cannot: both surfaces carry a rule, and the rules disagree.
const FIXTURE_ALWAYS = `## FR-scoped resume

An FR identity delivers that FR. Its milestone is resolved and carried, but the
milestone is not the unit of work.

When other active FRs remain bound to the milestone, the chain still runs to
\`/pr\`.

The chain always extends to \`/implement <FR-id>\` → \`/spec-archive M<N>\` →
\`/ship-milestone M<N>\` → \`/pr\`, regardless of how many FRs are still open.
`;

// The sentence shipped on this tree today (skills/deliver/SKILL.md), copied
// verbatim as the AC.3 isolation subject.
const SHIPPED_SUPERSEDED_SKILL_SENTENCE =
  "- **A milestone identity** (`M<N>`, `M_<epic-key>`, or a minted " +
  "`M_<short-ULID>` — the shared union grammar, never a private `M\\d+`) " +
  "**or an FR identity**, which resolves through its `milestone:` frontmatter " +
  "to the same routing.";

// The same sentence shipped in docs/deliver-reference.md today — a second,
// independently-worded instance, so the detector is not tuned to one phrasing.
const SHIPPED_SUPERSEDED_REFERENCE_SENTENCE =
  "It routes through the `milestone:` key in its own frontmatter, read with " +
  "the shared frontmatter reader, and then follows the milestone path above.";

// A corrected rewrite: still names the milestone frontmatter (the milestone IS
// still resolved), but makes no same-routing claim. Must NOT trip the detector.
const CORRECTED_SENTENCE =
  "An FR identity names one FR. Its milestone is resolved from the " +
  "`milestone:` key in the FR's frontmatter and carried through, but the " +
  "milestone is not the unit of work.";

/** Heading-to-next-`##` slice, matched tolerantly so a reworded heading holds. */
const section = (text: string, heading: RegExp): string => {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => heading.test(l));
  if (start === -1) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^##\s/.test(l));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
};

const ARGUMENT_HEADING = /^##+\s.*\bArgument\b.*$/;

// ---------------------------------------------------------------------------
// Extractor self-tests — run FIRST so a red elsewhere is attributable
// ---------------------------------------------------------------------------

describe("extractor is not vacuous", () => {
  test("a surface that states the last-active rule produces the expected claim", () => {
    expect(frScopeClaim(FIXTURE_LAST_ACTIVE)).toEqual(EXPECTED_CLAIM);
  });

  test("a surface that states an unconditional rule does NOT", () => {
    expect(frScopeClaim(FIXTURE_ALWAYS)).not.toEqual(EXPECTED_CLAIM);
  });

  test("the two fixtures differ ONLY in the auto-extend condition", () => {
    const a = frScopeClaim(FIXTURE_LAST_ACTIVE);
    const b = frScopeClaim(FIXTURE_ALWAYS);
    const differing = (Object.keys(a) as Array<keyof FrScopeClaim>).filter(
      (k) => a[k] !== b[k],
    );
    expect(differing).toEqual(["extendCondition"]);
    expect([a.extendCondition, b.extendCondition]).toEqual(["last_active", "always"]);
  });

  test("a surface stating no FR-scope rule at all scores absent, not expected", () => {
    const silent = frScopeClaim("# Nothing\n\nThis document says nothing about FRs.\n");
    expect(silent.extendCondition).toBe("absent");
    expect(silent).not.toEqual(EXPECTED_CLAIM);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-502.1 — the OPERATIVE surface states the FR-scoped chain + auto-extend
// ---------------------------------------------------------------------------

describe("AC-STE-502.1 — skills/deliver/SKILL.md states the rule itself", () => {
  test("the skill's claim is the expected one, on every independent token", () => {
    expect(frScopeClaim(skill())).toEqual(EXPECTED_CLAIM);
  });

  test("the rule is on the skill, not merely pointed at", () => {
    // A pointer to the reference is not a statement of the rule. The skill's own
    // FR-scope region must name all four chain steps.
    const region = frScopeParagraphs(skill()).join("\n\n");
    expect({
      region_nonempty: region.trim() !== "",
      implement: CUE.implement.test(region),
      specArchive: CUE.specArchive.test(region),
      shipMilestone: CUE.shipMilestone.test(region),
      pr: CUE.pr.test(region),
      lastActive: CUE.lastActive.test(region),
      frScoped: CUE.frScoped.test(region),
    }).toEqual({
      region_nonempty: true,
      implement: true,
      specArchive: true,
      shipMilestone: true,
      pr: true,
      lastActive: true,
      frScoped: true,
    });
  });

  test("NFR-1 tripwire — the skill still fits the 358-line cap", () => {
    // Line-cap pressure is explicitly NOT a defence in this FR: the edit must fit.
    const lines = skill().split("\n").length;
    expect({ over_cap: lines > SKILL_LINE_CAP }).toEqual({ over_cap: false });
  });
});

// ---------------------------------------------------------------------------
// AC-STE-502.2 — cross-surface AGREEMENT, asserted directly
// ---------------------------------------------------------------------------

describe("AC-STE-502.2 — the skill and the reference are compared to each other", () => {
  test("the two surfaces' extracted claims are equal", () => {
    // Note the subject: not "each file contains X" twice, but one surface's
    // claim measured against the other's. Two surfaces that both carry a rule
    // and disagree fail here and pass a per-surface presence check.
    expect(frScopeClaim(skill())).toEqual(frScopeClaim(reference()));
  });

  test("and the value they agree on is the shipped behaviour, not a shared error", () => {
    // Agreement alone is satisfiable by both surfaces being wrong in the same
    // way (or both silent), so the agreed value is pinned too.
    const s = frScopeClaim(skill());
    const r = frScopeClaim(reference());
    expect({ skill: s, reference: r }).toEqual({
      skill: EXPECTED_CLAIM,
      reference: EXPECTED_CLAIM,
    });
  });

  test("the comparison used above rejects two surfaces whose rules differ", () => {
    // Isolation leg for the comparison itself: same comparator, fixtures that
    // both carry a full rule, differing only in the auto-extend condition.
    expect(frScopeClaim(FIXTURE_LAST_ACTIVE)).not.toEqual(frScopeClaim(FIXTURE_ALWAYS));
  });

  test("neither surface still asserts the superseded same-routing claim", () => {
    expect({
      skill: hasSupersededSameRoutingClaim(skill()),
      reference: hasSupersededSameRoutingClaim(reference()),
    }).toEqual({ skill: false, reference: false });
  });
});

// ---------------------------------------------------------------------------
// AC-STE-502.3 — the superseded claim is GONE from argument classification
// ---------------------------------------------------------------------------

describe("AC-STE-502.3 — the argument-classification section drops the old claim", () => {
  test("isolation — the detector fires on the sentence shipped today (skill)", () => {
    expect(hasSupersededSameRoutingClaim(SHIPPED_SUPERSEDED_SKILL_SENTENCE)).toBe(true);
  });

  test("isolation — it fires on the reference's independently-worded instance", () => {
    expect(hasSupersededSameRoutingClaim(SHIPPED_SUPERSEDED_REFERENCE_SENTENCE)).toBe(
      true,
    );
  });

  test("isolation — it does NOT fire on a corrected rewrite naming the frontmatter", () => {
    // Proves the negative assertion targets the CLAIM (FR routes to the same
    // place as its milestone), not the vocabulary. The milestone is still
    // resolved and carried, and saying so must stay legal.
    expect(hasSupersededSameRoutingClaim(CORRECTED_SENTENCE)).toBe(false);
  });

  test("the skill's argument-classification section exists and is non-empty", () => {
    expect(section(skill(), ARGUMENT_HEADING).trim()).not.toBe("");
  });

  test("that section makes no same-routing claim about an FR identity", () => {
    const offenders = supersededSameRoutingSentences(section(skill(), ARGUMENT_HEADING));
    expect({ offenders }).toEqual({ offenders: [] });
  });
});

// ---------------------------------------------------------------------------
// AC-STE-502.4 — docs/workflow-overview.md reflects FR scope
// ---------------------------------------------------------------------------

describe("AC-STE-502.4 — the workflow map reflects FR scope", () => {
  test("it names /deliver at all", () => {
    expect(CUE.deliver.test(overview())).toBe(true);
  });

  test("it states FR scope, not only milestone scope", () => {
    const region = frScopeParagraphs(overview()).join("\n\n");
    expect({
      region_nonempty: region.trim() !== "",
      frScoped: CUE.frScoped.test(region),
    }).toEqual({ region_nonempty: true, frScoped: true });
  });

  test("its auto-extend condition agrees with BOTH other surfaces", () => {
    const conditions = {
      skill: frScopeClaim(skill()).extendCondition,
      reference: frScopeClaim(reference()).extendCondition,
      overview: frScopeClaim(overview()).extendCondition,
    };
    expect(conditions).toEqual({
      skill: "last_active",
      reference: "last_active",
      overview: "last_active",
    });
  });
});

// ---------------------------------------------------------------------------
// AC-STE-502.5 — MUTATION: move the rule off the operative surface ⇒ RED
// ---------------------------------------------------------------------------

interface Mutation {
  readonly mutatedSkill: string;
  readonly mutatedReference: string;
  /** The reference with its own FR-scope rule removed, before the append. */
  readonly strippedReference: string;
  readonly moved: readonly string[];
}

/**
 * The mutation this AC names, built and executed rather than described: take the
 * skill's text, REMOVE the FR-scope rule from it, and APPEND that rule to the
 * reference's text. Nothing is written to disk.
 */
const moveRuleIntoReferenceAlone = (): Mutation => {
  const paras = paragraphs(skill());
  const moved = paras.filter(isFrScopeParagraph);
  const kept = paras.filter((p) => !isFrScopeParagraph(p));
  // The reference is STRIPPED of its own FR-scope paragraphs before the skill's
  // are appended. Appending to the intact reference would have made the
  // "survived the move" leg pass on the reference's OWN rule, so a mutation
  // that deleted the skill's paragraphs and appended them nowhere would have
  // read identically — move and delete were indistinguishable.
  const strippedReference = paragraphs(reference()).filter(
    (para) => !isFrScopeParagraph(para),
  );
  return {
    mutatedSkill: kept.join("\n\n") + "\n",
    mutatedReference: [...strippedReference, ...moved].join("\n\n") + "\n",
    strippedReference: strippedReference.join("\n\n") + "\n",
    moved,
  };
};

describe("AC-STE-502.5 — moving the rule back into the reference alone goes RED", () => {
  test("the mutation actually applies — at least one paragraph is moved", () => {
    // A mutation that never applied reads as a pass (M124). This leg is the
    // guard: if the skill states nothing, there is nothing to move, and the
    // mutation below would be vacuously 'detected'.
    const { moved } = moveRuleIntoReferenceAlone();
    expect({ moved_count_is_zero: moved.length === 0 }).toEqual({
      moved_count_is_zero: false,
    });
  });

  test("the AC.1 predicate FAILS on the mutated skill", () => {
    const { mutatedSkill } = moveRuleIntoReferenceAlone();
    expect(frScopeClaim(mutatedSkill)).not.toEqual(EXPECTED_CLAIM);
  });

  test("...and PASSES on the mutated reference — so the RED is about PLACEMENT", () => {
    // Without this half the previous test is also satisfied by simply deleting
    // the rule everywhere. Here the rule demonstrably survived the move; the
    // only thing that changed is which surface carries it.
    const { mutatedReference } = moveRuleIntoReferenceAlone();
    expect(frScopeClaim(mutatedReference)).toEqual(EXPECTED_CLAIM);
  });

  test("control — the UNMUTATED skill passes the same predicate", () => {
    expect(frScopeClaim(skill())).toEqual(EXPECTED_CLAIM);
  });

  test("control — the STRIPPED reference alone does NOT satisfy the predicate", () => {
    // This is what makes the leg above about PLACEMENT. The stripped reference
    // fails on its own, so the mutated reference can only pass because the
    // skill's paragraphs arrived there — a delete-and-append-nowhere mutation
    // leaves it failing.
    const { strippedReference } = moveRuleIntoReferenceAlone();
    expect(frScopeClaim(strippedReference)).not.toEqual(EXPECTED_CLAIM);
  });

  test("the cross-surface comparison also breaks under the mutation", () => {
    const { mutatedSkill, mutatedReference } = moveRuleIntoReferenceAlone();
    expect(frScopeClaim(mutatedSkill)).not.toEqual(frScopeClaim(mutatedReference));
  });
});
