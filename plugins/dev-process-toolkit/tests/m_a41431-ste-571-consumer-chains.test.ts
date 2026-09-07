// STE-571 — the chains a consumer follows name the gates they will hit.
//
// Two shipped surfaces carry the same workflow chart: `templates/CLAUDE.md.template`,
// which is copied verbatim into every bootstrapped project, and § Step 11 of
// `docs/setup-reference.md`, which is what this repo's own /setup run surfaces.
// They disagreed, and neither named `/spec-review` before `/pr` even though the
// `pre-pr-spec-review` hook blocks `gh pr create` until it has run.
//
// The defect that already shipped is *drift between two copies*, so the AC.3 legs
// below never pin either copy against a literal — they EXTRACT the ordered skill
// sequence from both files and compare the two extractions. A later edit to the
// canonical side that skips the other still reds, which a literal pin could not do.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mutate } from "./_fence";

const pluginRoot = join(import.meta.dir, "..");
const read = (p: string) => readFileSync(p, "utf-8");

const TEMPLATE_PATH = join(pluginRoot, "templates", "CLAUDE.md.template");
const REFERENCE_PATH = join(pluginRoot, "docs", "setup-reference.md");

const template = () => read(TEMPLATE_PATH);
const reference = () => read(REFERENCE_PATH);

// ---------------------------------------------------------------------------
// Extraction — one reader, used by both surfaces and by every mutation.
// ---------------------------------------------------------------------------

/** A chain line: `**Label:** \`/a → /b\``, optionally a list item. */
const CHAIN_LINE = /^[ \t]*(?:-[ \t]*)?\*\*([A-Za-z][A-Za-z ]*):\*\*[ \t]*`(\/[^`]*)`[ \t]*$/gm;

/** Every chain label in a body, in document order. */
function chainLabels(body: string): string[] {
  return [...body.matchAll(CHAIN_LINE)].map((m) => m[1]!);
}

/** The whole source line for one chain, or "" when that chain is absent. */
function chainLine(body: string, label: string): string {
  for (const m of body.matchAll(CHAIN_LINE)) if (m[1] === label) return m[0]!;
  return "";
}

/**
 * The ordered `/<skill>` tokens on one chain's line.
 *
 * Tokens only — the template writes `/tdd (auto)` and the parenthetical is
 * commentary, not a step, so comparing rendered lines across the two surfaces
 * would red on prose the AC does not govern.
 */
function chainTokens(body: string, label: string): string[] {
  const line = chainLine(body, label);
  return [...line.matchAll(/\/[a-z][a-z0-9-]*/g)].map((m) => m[0]!);
}

// ---------------------------------------------------------------------------
// Predicates — pure over a body, so a mutation can be graded by the same reader
// that grades the landed tree. Every AC.4 leg measures clean FIRST, then mutates.
// ---------------------------------------------------------------------------

/** AC.1 — this chain names `/spec-review` at some point before `/pr`. */
function chainNamesSpecReviewBeforePr(body: string, label: string): boolean {
  const toks = chainTokens(body, label);
  const review = toks.indexOf("/spec-review");
  const pr = toks.indexOf("/pr");
  return review > -1 && pr > -1 && review < pr;
}

const HOOKS = [
  {
    name: "pre-commit-gate-check",
    trigger: "git commit",
    skill: "dev-process-toolkit:gate-check",
  },
  {
    name: "pre-pr-spec-review",
    trigger: "gh pr create",
    skill: "dev-process-toolkit:spec-review",
  },
  {
    name: "pre-commit-tdd-orchestrator",
    trigger: "git commit",
    skill: "dev-process-toolkit:tdd",
  },
] as const;

const HOOKS_MANUAL = "docs/hooks-reference.md";

/** The `##` section of the template that points at the hooks manual. */
function gateBlock(body: string): string {
  const sections = body
    .split(/^## /m)
    .map((s, i) => (i === 0 ? s : `## ${s}`));
  return sections.find((s) => s.includes(HOOKS_MANUAL)) ?? "";
}

/**
 * The slice of the gate block that belongs to one hook: from its name up to the
 * next hook's name. Per-hook, so hook #1's `git commit` cannot stand in for
 * hook #3's, and a missing hook is a miss rather than a block-wide substring hit.
 */
function hookEntry(block: string, name: string): string | null {
  const start = block.indexOf(name);
  if (start === -1) return null;
  const later = HOOKS.map((h) => block.indexOf(h.name))
    .filter((i) => i > start)
    .sort((a, b) => a - b);
  return block.slice(start, later.length > 0 ? later[0] : undefined);
}

/** AC.2 — the block names one hook with its trigger command and its skill. */
function gateBlockDescribesHook(body: string, name: string): boolean {
  const hook = HOOKS.find((h) => h.name === name)!;
  const entry = hookEntry(gateBlock(body), name);
  return entry !== null && entry.includes(hook.trigger) && entry.includes(hook.skill);
}

/** AC.2 — all three, so naming two of three is false. */
const gateBlockNamesEveryHook = (body: string): boolean =>
  HOOKS.length === 3 && HOOKS.every((h) => gateBlockDescribesHook(body, h.name));

/** AC.3 — the two surfaces carry the same chains with the same steps. */
function chainsAgree(tpl: string, ref: string): boolean {
  const labels = chainLabels(tpl);
  if (labels.length === 0) return false;
  if (JSON.stringify(labels) !== JSON.stringify(chainLabels(ref))) return false;
  return labels.every(
    (l) =>
      JSON.stringify(chainTokens(tpl, l)) === JSON.stringify(chainTokens(ref, l)),
  );
}

/** AC.3 — a line somewhere that names BOTH surfaces and says which one rules. */
function canonicalDeclaration(tpl: string, ref: string): string | null {
  for (const body of [tpl, ref]) {
    const line = body
      .split("\n")
      .find(
        (l) =>
          l.includes("CLAUDE.md.template") &&
          l.includes("setup-reference.md") &&
          /canonic|source of truth/i.test(l),
      );
    if (line) return line;
  }
  return null;
}

// ===========================================================================
// Zero-hit guard — an extraction that finds nothing must fail loudly here,
// not quietly satisfy an `every()` further down.
// ===========================================================================

describe("the readers are pointed at the surfaces this FR governs", () => {
  test("both shipped files are non-trivial and carry chain lines", () => {
    expect(template().length).toBeGreaterThan(1000);
    expect(reference().length).toBeGreaterThan(1000);
    expect(chainLabels(template()).length).toBeGreaterThanOrEqual(4);
    expect(chainLabels(reference()).length).toBeGreaterThanOrEqual(3);
  });

  test("the token reader returns an ordered chain, not a bag", () => {
    // Measured against a step the FR does not touch, so this guard survives the
    // edit that turns the AC legs green.
    expect(chainTokens(template(), "Refactor").slice(0, 2)).toEqual([
      "/implement",
      "/simplify",
    ]);
  });
});

// ===========================================================================
// AC-STE-571.1 — every chain in the template names /spec-review before /pr
// ===========================================================================

describe("AC-STE-571.1 — all four template chains name /spec-review before /pr", () => {
  // Four separate cases, per the AC: three of four passing is a fail.
  for (const label of ["Bugfix", "Feature", "Refactor", "UI change"] as const) {
    test(`${label} names /spec-review before /pr`, () => {
      const toks = chainTokens(template(), label);
      expect(toks.length, `${label} chain not found in the template`).toBeGreaterThan(2);
      expect(toks, `${label} omits /spec-review`).toContain("/spec-review");
      expect(toks.indexOf("/spec-review")).toBeLessThan(toks.indexOf("/pr"));
      expect(chainNamesSpecReviewBeforePr(template(), label)).toBe(true);
    });
  }

  test("the existing ordered pin at m84-ste-324:336 still holds for Feature", () => {
    // That pin walks the Feature chain with an at-or-after cursor, so inserting
    // /spec-review between /ship-milestone and /pr is safe and reordering is not.
    // Asserted here too so this FR cannot green itself by breaking a sibling.
    const toks = chainTokens(template(), "Feature");
    const seq = [
      "/spec-write",
      "/implement",
      "/tdd",
      "/gate-check",
      "/docs",
      "/ship-milestone",
      "/pr",
    ];
    let cursor = -1;
    for (const tok of seq) {
      const at = toks.indexOf(tok);
      expect(at, `${tok} out of order in the Feature chain`).toBeGreaterThan(cursor);
      cursor = at;
    }
  });
});

// ===========================================================================
// AC-STE-571.2 — the template announces the three blocking hooks
// ===========================================================================

describe("AC-STE-571.2 — the gate block names all three blocking hooks", () => {
  test("the block exists and points at the hooks manual", () => {
    const block = gateBlock(template());
    expect(block, "no template section cites the hooks manual").not.toBe("");
    expect(block).toContain(HOOKS_MANUAL);
  });

  // Three separate cases, per the AC: naming two of the three fails.
  for (const hook of HOOKS) {
    test(`${hook.name} is named with its trigger and its skill`, () => {
      const entry = hookEntry(gateBlock(template()), hook.name);
      expect(entry, `${hook.name} is not named in the gate block`).not.toBeNull();
      expect(entry!, `${hook.name} entry omits its trigger`).toContain(hook.trigger);
      expect(entry!, `${hook.name} entry omits its skill`).toContain(hook.skill);
      expect(gateBlockDescribesHook(template(), hook.name)).toBe(true);
    });
  }

  test("all three together", () => {
    expect(gateBlockNamesEveryHook(template())).toBe(true);
  });
});

// ===========================================================================
// AC-STE-571.3 — the two copies are compared against EACH OTHER
// ===========================================================================

describe("AC-STE-571.3 — the reference copy agrees with the template", () => {
  test("both surfaces list the same chains", () => {
    expect(chainLabels(reference())).toEqual(chainLabels(template()));
  });

  for (const label of ["Bugfix", "Feature", "Refactor"] as const) {
    test(`${label}: the two extractions are identical`, () => {
      const fromTemplate = chainTokens(template(), label);
      expect(fromTemplate.length, `${label} missing from the template`).toBeGreaterThan(2);
      expect(chainTokens(reference(), label)).toEqual(fromTemplate);
    });
  }

  test("the whole comparison holds", () => {
    expect(chainsAgree(template(), reference())).toBe(true);
  });

  test("one copy is declared canonical, naming both surfaces", () => {
    const line = canonicalDeclaration(template(), reference());
    expect(
      line,
      "no line names both CLAUDE.md.template and setup-reference.md as canonical/copy",
    ).not.toBeNull();
    expect(line!).toContain("CLAUDE.md.template");
    expect(line!).toContain("setup-reference.md");
  });
});

// ===========================================================================
// AC-STE-571.4 — falsifiability. Every mutation is measured clean FIRST, and
// every one is applied through the throwing `mutate` helper, so a mutation that
// never matched raises instead of reading as a pass.
// ===========================================================================

describe("AC-STE-571.4 — the three clauses are mutation-tested", () => {
  /** Splice a mutated chain line back into its surface. */
  const withChain = (body: string, label: string, mutated: string): string => {
    const line = chainLine(body, label);
    expect(line, `${label} chain not found`).not.toBe("");
    return body.replace(line, mutated);
  };

  test("AC.1 — dropping /spec-review from ONE chain reds only that chain", () => {
    const clean = template();
    expect(chainNamesSpecReviewBeforePr(clean, "Bugfix")).toBe(true);
    expect(chainNamesSpecReviewBeforePr(clean, "UI change")).toBe(true);

    const line = chainLine(clean, "Bugfix");
    const dropped = mutate(
      line,
      /\/spec-review[ \t]*(?:→|->)[ \t]*|[ \t]*(?:→|->)[ \t]*\/spec-review/,
      "",
    );
    const mutated = withChain(clean, "Bugfix", dropped);

    expect(chainNamesSpecReviewBeforePr(mutated, "Bugfix")).toBe(false);
    // Isolation: the other three chains are untouched, so the per-chain legs
    // above genuinely test four things and not one.
    expect(chainNamesSpecReviewBeforePr(mutated, "UI change")).toBe(true);
  });

  test("AC.1 — dropping it from the LAST chain reds too", () => {
    const clean = template();
    expect(chainNamesSpecReviewBeforePr(clean, "UI change")).toBe(true);
    const dropped = mutate(
      chainLine(clean, "UI change"),
      /\/spec-review[ \t]*(?:→|->)[ \t]*|[ \t]*(?:→|->)[ \t]*\/spec-review/,
      "",
    );
    const mutated = withChain(clean, "UI change", dropped);
    expect(chainNamesSpecReviewBeforePr(mutated, "UI change")).toBe(false);
    expect(chainNamesSpecReviewBeforePr(mutated, "Bugfix")).toBe(true);
  });

  test("AC.2 — naming only two of the three hooks reds the block", () => {
    const clean = template();
    expect(gateBlockNamesEveryHook(clean)).toBe(true);

    for (const dropped of HOOKS) {
      // Global replace: a block that names the hook twice (entry + script file)
      // would otherwise survive a first-occurrence mutation.
      const mutated = mutate(clean, new RegExp(dropped.name, "g"), "pre-removed-hook");
      expect(gateBlockDescribesHook(mutated, dropped.name), dropped.name).toBe(false);
      expect(gateBlockNamesEveryHook(mutated), dropped.name).toBe(false);
      // The other two survive — so the three legs above are three assertions.
      for (const kept of HOOKS.filter((h) => h.name !== dropped.name)) {
        expect(gateBlockDescribesHook(mutated, kept.name), kept.name).toBe(true);
      }
    }
  });

  test("AC.2 — dropping a hook's TRIGGER reds it, not just its name", () => {
    const clean = template();
    expect(gateBlockDescribesHook(clean, "pre-pr-spec-review")).toBe(true);
    const mutated = mutate(clean, /gh pr create/g, "the PR command");
    expect(gateBlockDescribesHook(mutated, "pre-pr-spec-review")).toBe(false);
    expect(gateBlockNamesEveryHook(mutated)).toBe(false);
  });

  test("AC.3 — reverting the REFERENCE chain to its pre-FR text reds the agreement", () => {
    const tpl = template();
    const ref = reference();
    expect(chainsAgree(tpl, ref)).toBe(true);

    const reverted = mutate(
      ref,
      /^[ \t]*-[ \t]*\*\*Bugfix:\*\*.*$/m,
      "- **Bugfix:** `/debug → /implement → /gate-check → /pr`",
    );
    expect(chainsAgree(tpl, reverted)).toBe(false);
  });

  test("AC.3 — reverting the TEMPLATE chain reds the agreement too", () => {
    const tpl = template();
    const ref = reference();
    expect(chainsAgree(tpl, ref)).toBe(true);

    const reverted = mutate(
      tpl,
      /^[ \t]*\*\*Bugfix:\*\*.*$/m,
      "**Bugfix:** `/report-issue → /debug → /implement → /tdd (auto) → /gate-check → /pr`",
    );
    expect(chainsAgree(reverted, ref)).toBe(false);
  });

  test("AC.3 — dropping a whole chain from the reference reds the agreement", () => {
    const tpl = template();
    const ref = reference();
    expect(chainsAgree(tpl, ref)).toBe(true);
    const dropped = mutate(ref, /^[ \t]*-[ \t]*\*\*Refactor:\*\*.*$\n/m, "");
    expect(chainLabels(dropped)).not.toEqual(chainLabels(tpl));
    expect(chainsAgree(tpl, dropped)).toBe(false);
  });

  test("AC.3 — removing the canonical declaration reds that leg", () => {
    const tpl = template();
    const ref = reference();
    const line = canonicalDeclaration(tpl, ref);
    expect(line).not.toBeNull();
    const strippedTpl = tpl.includes(line!) ? mutate(tpl, line!, "") : tpl;
    const strippedRef = ref.includes(line!) ? mutate(ref, line!, "") : ref;
    expect(canonicalDeclaration(strippedTpl, strippedRef)).toBeNull();
  });

  test("the mutation helper itself refuses a mutation that never applied", () => {
    // The guard that stops every leg above from passing vacuously.
    expect(() => mutate(template(), /this string is not in the template/, "x")).toThrow(
      /mutation did not apply/,
    );
  });
});
