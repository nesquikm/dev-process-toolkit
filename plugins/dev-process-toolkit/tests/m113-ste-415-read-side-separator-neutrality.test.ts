// M113 / STE-415 — read-side separator neutrality (spec-deviation backfill).
//
// STE-415 flipped the milestone plan-heading EMIT side from the colon form
// (`## M<N>: <Title>`) to the em-dash canonical form (`## M<N> — <Title>`).
// The parser (`parsePlanHeading`) has accepted both since STE-335, so the emit
// flip is safe there — but the REFACTOR and AUDIT passes both found read-side
// consumers that match ONLY the colon form. Those are now silently vacuous
// against every freshly-emitted plan file:
//
//   T1  skills/setup/SKILL.md:70      — doctor "Spec anchor IDs" grep exemplar
//   T2  docs/patterns.md:332          — documented missing-anchor grep pattern
//   T3  docs/patterns.md:322 / :329   — anchor-conventions table row + example
//   T4  skills/spec-archive/SKILL.md:64, adapters/_shared/src/{plan_only_archival,
//       attach_project_milestone,tracker_project_milestone_attached}.ts
//                                     — prose/comments calling colon "current"
//
// Deliberately OUT OF SCOPE (pre-existing, separate defect): the `M[0-9]+` leaf
// in the documented grep pattern predates the `M_<epic-key>` union grammar in
// `adapters/_shared/src/milestone_token.ts`. Nothing here asserts on it — this
// backfill is a SEPARATOR-only fix.
//
// Also deliberately untouched: `adapters/_shared/src/plan_heading.ts` (parser
// immutability is pinned by AC-STE-415.4), `specs/plan/M112.md` / `M114.md`, and
// the `tests/fixtures/projects/*/specs/plan.md` fixtures — their colon-form
// content is intentional legacy coverage.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pluginRoot = join(import.meta.dir, "..");
const EM_DASH = "—";

function read(relPath: string): string {
  return readFileSync(join(pluginRoot, relPath), "utf8");
}

const setupSkill = read("skills/setup/SKILL.md");
const specArchiveSkill = read("skills/spec-archive/SKILL.md");
const patterns = read("docs/patterns.md");
const planTemplate = read("templates/spec-templates/plan.md.template");
const planOnlySrc = read("adapters/_shared/src/plan_only_archival.ts");
const attachSrc = read("adapters/_shared/src/attach_project_milestone.ts");
const probe26Src = read("adapters/_shared/src/tracker_project_milestone_attached.ts");

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The single line containing `marker` ("" when absent). */
function lineContaining(body: string, marker: string): string {
  return body.split("\n").find((l) => l.includes(marker)) ?? "";
}

/** Backticked literals in `text` that show a `## M<N>` / `## M{N}` heading. */
function headingLiterals(text: string): string[] {
  return [...text.matchAll(/`[^`\n]*##\s*M[<{]N[>}][^`\n]*`/g)].map((m) => m[0]);
}

/** The separator character a `## <token>` heading form uses ("—", ":", …). */
function headingSeparator(text: string, token: string): string | null {
  const m = new RegExp("##\\s+" + esc(token) + "\\s*(\\S)").exec(text);
  return m ? m[1]! : null;
}

/** Matches an em-dash-form heading mention, e.g. `## M<N> — <title>`. */
function emDashHeadingRe(token: string): RegExp {
  return new RegExp("##\\s*" + esc(token) + "\\s*" + EM_DASH);
}

/** Prose that qualifies a colon-form heading literal as "current". */
function currentQualifiesColonRe(token: string): RegExp {
  return new RegExp("current[^`]{0,60}`[^`\\n]*##\\s*" + esc(token) + "\\s*:", "i");
}

/** ±`radius`-char windows around every colon-form heading mention. */
function colonMentionWindows(text: string, token: string, radius = 200): string[] {
  const re = new RegExp("##\\s*" + esc(token) + "\\s*:", "g");
  return [...text.matchAll(re)].map((m) =>
    text.slice(Math.max(0, m.index - radius), m.index + m[0].length + radius),
  );
}

const LEGACY_FRAMING = /legacy|older|historic|tolerat|still\s+(?:parse|accept)/i;

/**
 * Classify a surface that mentions the milestone heading form. `"dropped"` is a
 * legal outcome only where the claim itself is fiction (the heading-agnostic
 * plan-only heuristic); elsewhere the surface must be `"em-dash"`.
 */
function headingFormVerdict(text: string, token: string): string {
  if (colonMentionWindows(text, token).length === 0 && !emDashHeadingRe(token).test(text)) {
    return "dropped";
  }
  return emDashHeadingRe(token).test(text) ? "em-dash" : "colon-only (stale)";
}

// The emit-side source of truth: whatever separator the plan template scaffolds
// is the separator every read-side consumer and doc must describe. Derived, not
// hardcoded — that is what makes T3 a self-contradiction test.
const templateHeadingLine = (planTemplate.match(/^##\s+M<N>.*$/m) ?? [""])[0]!;
const templateSep = headingSeparator(planTemplate, "M<N>");

describe("emit-side source of truth (slice sanity)", () => {
  test("plan.md.template scaffolds exactly one `## M<N>` milestone heading", () => {
    expect(planTemplate.match(/^##\s+M<N>.*$/gm) ?? []).toHaveLength(1);
    expect(templateHeadingLine).toContain("{#M<N>}");
  });

  test("the template's separator is the em-dash canonical form", () => {
    expect(templateSep).toBe(EM_DASH);
  });
});

// ---------------------------------------------------------------------------
// T1 — /setup doctor "Spec anchor IDs" check (skills/setup/SKILL.md:70)
// ---------------------------------------------------------------------------

describe("T1 — /setup doctor anchor check is separator-neutral", () => {
  const anchorRow = lineContaining(setupSkill, "Spec anchor IDs");

  test("the doctor row exists and still greps plan files for anchors (slice sanity)", () => {
    expect(anchorRow).toContain("specs/plan/M*.md");
    expect(anchorRow).toContain("{#M{N}}");
    expect(anchorRow).toContain("{#FR-{N}}");
  });

  test("the milestone-heading match accepts the em-dash form the template emits", () => {
    const lits = headingLiterals(anchorRow);
    expect(lits.length).toBeGreaterThan(0);
    expect(lits.filter((l) => l.includes(templateSep!))).not.toEqual([]);
  });

  test("colon tolerance is retained so legacy plan files still get warned", () => {
    const lits = headingLiterals(anchorRow);
    expect(lits.filter((l) => /M\{N\}[^`]*:/.test(l))).not.toEqual([]);
  });

  test("the FR-heading half of the row is untouched (colon is correct there)", () => {
    expect(anchorRow).toContain("### FR-{N}:");
  });
});

// ---------------------------------------------------------------------------
// T2 — documented missing-anchor grep pattern (docs/patterns.md:332)
// ---------------------------------------------------------------------------

describe("T2 — documented missing-anchor grep pattern is separator-neutral", () => {
  const grepLine = lineContaining(patterns, "Grep pattern to find missing anchors");
  const literals = [...grepLine.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]!);
  // The plan.md pattern is the `^##`-anchored one; `(?!#)` excludes `^###` (FR).
  const planPattern = literals.find((l) => /\^#{2}(?!#)/.test(l)) ?? "";
  const frPattern = literals.find((l) => /\^#{3}/.test(l)) ?? "";

  test("the documented grep line still names both patterns (slice sanity)", () => {
    expect(grepLine).toContain("plan.md");
    expect(planPattern).not.toBe("");
    expect(frPattern).toContain("FR-");
  });

  test("the plan.md pattern matches the heading the plan template actually emits", () => {
    const emitted = templateHeadingLine.replace(/M<N>/g, "M3");
    expect(new RegExp(planPattern).test(emitted)).toBe(true);
  });

  test("the plan.md pattern matches an em-dash milestone heading", () => {
    expect(new RegExp(planPattern).test(`## M3 ${EM_DASH} User authentication {#M3}`)).toBe(true);
  });

  test("the plan.md pattern still matches the legacy colon heading", () => {
    expect(new RegExp(planPattern).test("## M3: User authentication {#M3}")).toBe(true);
  });

  test("the plan.md pattern stays anchored to H2 milestone headings only", () => {
    const re = new RegExp(planPattern);
    expect(re.test("### FR-3: Something {#FR-3}")).toBe(false);
    expect(re.test(`# M3 ${EM_DASH} Legacy H1 heading`)).toBe(false);
  });

  test("the FR pattern is unchanged (its colon is the real FR emit form)", () => {
    expect(new RegExp(frPattern).test("### FR-3: User authentication {#FR-3}")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T3 — anchor-conventions table + worked example (docs/patterns.md:322 / :329)
// ---------------------------------------------------------------------------

describe("T3 — documented milestone heading form matches its own source of truth", () => {
  const milestoneRow = lineContaining(patterns, "| Milestone |");
  const frRow = lineContaining(patterns, "| FR |");
  const exampleBlock =
    patterns.split("Example of a properly anchored milestone heading")[1]?.split("```")[1] ?? "";

  test("the table row exists and names the plan template as its source of truth", () => {
    expect(milestoneRow).toContain("templates/spec-templates/plan.md.template");
    expect(exampleBlock).not.toBe("");
  });

  test("the row's heading form uses the same separator the named template emits", () => {
    expect(headingSeparator(milestoneRow, "M{N}")).toBe(templateSep);
  });

  test("the row keeps the `{#M{N}}` anchor convention", () => {
    expect(milestoneRow).toContain("{#M{N}}");
  });

  test("the worked example uses the same separator the named template emits", () => {
    expect(headingSeparator(exampleBlock, "M3")).toBe(templateSep);
  });

  test("the worked example keeps its `{#M3}` anchor", () => {
    expect(exampleBlock).toContain("{#M3}");
  });

  test("the FR row is untouched — `### FR-{N}: {title}` stays colon-form", () => {
    expect(frRow).toContain("### FR-{N}: {title}");
    expect(frRow).toContain("{#FR-{N}}");
  });
});

// ---------------------------------------------------------------------------
// T4 — prose/comments describing colon as "the current format"
// ---------------------------------------------------------------------------

describe("T4a — /spec-archive plan-only auto-detect prose", () => {
  // `plan_only_archival.ts` scans EVERY task line in the plan file — the
  // heuristic is heading-agnostic — so a colon-scoped claim here is descriptive
  // fiction. Dropping the heading scope or making it separator-neutral both fix
  // it; a surviving colon-only heading claim does not.
  test("the plan-only step no longer claims a colon-scoped heading block", () => {
    expect(["dropped", "em-dash"]).toContain(headingFormVerdict(specArchiveSkill, "M<N>"));
  });

  test("any surviving colon mention is framed as legacy, not as current", () => {
    for (const w of colonMentionWindows(specArchiveSkill, "M<N>")) {
      expect(w).toMatch(LEGACY_FRAMING);
    }
    expect(specArchiveSkill).not.toMatch(currentQualifiesColonRe("M<N>"));
  });
});

describe("T4b — plan_only_archival.ts comments", () => {
  test("the eligibility-signal comments no longer claim a colon-scoped block", () => {
    expect(["dropped", "em-dash"]).toContain(headingFormVerdict(planOnlySrc, "M<N>"));
  });

  test("any surviving colon mention is framed as legacy, not as current", () => {
    for (const w of colonMentionWindows(planOnlySrc, "M<N>")) {
      expect(w).toMatch(LEGACY_FRAMING);
    }
    expect(planOnlySrc).not.toMatch(currentQualifiesColonRe("M<N>"));
  });
});

describe("T4c — attach_project_milestone.ts docstring + throw message", () => {
  const docstring =
    attachSrc.split("Build the canonical milestone name from a plan-file path")[1]?.split("*/")[0] ??
    "";
  const throwMessage = (() => {
    const i = attachSrc.indexOf("has no recognizable milestone heading");
    return i === -1 ? "" : attachSrc.slice(i, i + 300);
  })();

  test("both prose sites exist (slice sanity)", () => {
    expect(docstring).toContain("parsePlanHeading");
    expect(throwMessage).toContain("expected");
  });

  test("the docstring lists the em-dash H2 form as the accepted current shape", () => {
    expect(docstring).toMatch(emDashHeadingRe("M<N>"));
  });

  test("the docstring no longer calls the colon form the current one", () => {
    expect(docstring).not.toMatch(currentQualifiesColonRe("M<N>"));
  });

  test("the throw message's expected-forms list includes the em-dash H2 form", () => {
    expect(throwMessage).toMatch(emDashHeadingRe("M<N>"));
  });

  test("any surviving colon mention is framed as legacy", () => {
    for (const w of colonMentionWindows(attachSrc, "M<N>")) {
      expect(w).toMatch(LEGACY_FRAMING);
    }
  });
});

describe("T4d — tracker_project_milestone_attached.ts comments", () => {
  test("the header comment lists the em-dash H2 form as the accepted current shape", () => {
    expect(probe26Src).toMatch(emDashHeadingRe("M<N>"));
  });

  test("no comment calls the colon form the current / current-format one", () => {
    expect(probe26Src).not.toMatch(currentQualifiesColonRe("M<N>"));
    expect(probe26Src).not.toMatch(/current-format\s*`[^`\n]*##\s*M<N>\s*:/);
  });

  test("any surviving colon mention is framed as legacy", () => {
    for (const w of colonMentionWindows(probe26Src, "M<N>")) {
      expect(w).toMatch(LEGACY_FRAMING);
    }
  });
});
