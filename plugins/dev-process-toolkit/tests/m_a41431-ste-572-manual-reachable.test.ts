// STE-572 — the manual for the gates is reachable from where an agent looks.
//
// The hooks manual is correct and unreachable. Every surface that describes the
// bundled hooks names the two harmless capture triggers (`SessionEnd`, `Stop`)
// and omits the three that refuse, so a reader who follows the repository's own
// signposts is told the hooks directory holds capture wiring and nothing else.
//
// Six surfaces, six separate readers. A single "the gates are documented
// somewhere" assertion would pass on any one of them, which is the shape this
// milestone exists to retire — so each AC below gets its own predicate, and the
// per-gate legs are three cases, not one, because naming two of three is a fail.
//
// Every predicate is PURE OVER A BODY STRING. That is what lets the AC.8
// mutation legs grade a mutated copy with the exact reader that grades the
// landed tree: a mutation is only evidence if the thing it reds is the thing
// the live case greens.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deriveBlockingGates } from "./_blocking_gates";
import { runPublicSurfaceCountDriftProbe } from "../adapters/_shared/src/public_surface_count_drift";
import { mutate } from "./_fence";

const pluginRoot = join(import.meta.dir, "..");
const repoRoot = join(pluginRoot, "..", "..");

/**
 * The blocking gates as the hook entry points themselves declare them.
 *
 * Computed ONCE, here, so every roll-up below grades the hand-kept `GATES`
 * against a set that grows the day a fourth entry point lands. `GATES` is
 * deliberately NOT replaced by it: the point-of-use rows below bind `GATES[0]`
 * and `GATES[1]` BY INDEX, and the derivation is name-sorted.
 */
const DERIVED_GATES = deriveBlockingGates(pluginRoot);
const read = (p: string) => readFileSync(p, "utf-8");

const README_PATH = join(repoRoot, "README.md");
const ROOT_CLAUDE_PATH = join(repoRoot, "CLAUDE.md");
const CONTRACTS_PATH = join(pluginRoot, "docs", "honored-contracts.md");
const MANUAL_PATH = join(pluginRoot, "docs", "hooks-reference.md");
const WORKFLOW_PATH = join(pluginRoot, "docs", "workflow-overview.md");
const PR_SKILL_PATH = join(pluginRoot, "skills", "pr", "SKILL.md");
const GATE_SKILL_PATH = join(pluginRoot, "skills", "gate-check", "SKILL.md");
const CAP_TEST_PATH = join(pluginRoot, "tests", "skill-nfr-1-length.test.ts");

const readme = () => read(README_PATH);
const rootClaude = () => read(ROOT_CLAUDE_PATH);
const contracts = () => read(CONTRACTS_PATH);
const manual = () => read(MANUAL_PATH);
const workflow = () => read(WORKFLOW_PATH);

// ---------------------------------------------------------------------------
// The subject. Hand-kept ON PURPOSE — and graded against the derived set.
//
// Nothing reads `hooks/hooks.json` to produce this array; it is typed here
// because the point-of-use rows below bind `GATES[0]` and `GATES[1]` BY INDEX
// to specific skill files, and `DERIVED_GATES` is name-sorted — so the
// derivation cannot simply take its place. What keeps the typing honest is the
// agreement test that runs first below: the day a fourth entry point lands the
// derived set grows, and this list reds until someone extends it.
// ---------------------------------------------------------------------------

interface BlockingGate {
  /** The hook's registered name. */
  name: string;
  /** The Skill invocation the hook demands in the transcript. */
  skill: string;
  /** The command whose PreToolUse the hook intercepts. */
  trigger: string;
}

const GATES: readonly BlockingGate[] = [
  {
    name: "pre-commit-gate-check",
    skill: "dev-process-toolkit:gate-check",
    trigger: "git commit",
  },
  {
    name: "pre-pr-spec-review",
    skill: "dev-process-toolkit:spec-review",
    trigger: "gh pr create",
  },
  {
    name: "pre-commit-tdd-orchestrator",
    skill: "dev-process-toolkit:tdd",
    trigger: "git commit",
  },
] as const;

/** The FRs that established and hardened the blocking hook layer. */
const PRECEDENT_FRS = ["STE-285", "STE-289", "STE-290", "STE-291"] as const;

const MANUAL_REL = "docs/hooks-reference.md";
const CONTRACTS_REL = "docs/honored-contracts.md";

// ---------------------------------------------------------------------------
// Generic readers
// ---------------------------------------------------------------------------

/** The `## <name>` section of a markdown body, heading included, or "". */
function section(body: string, headingPredicate: (heading: string) => boolean): string {
  const parts = body.split(/^## /m);
  for (let i = 1; i < parts.length; i++) {
    const whole = `## ${parts[i]!}`;
    const heading = whole.split("\n", 1)[0]!.slice(3).trim();
    if (headingPredicate(heading)) return whole;
  }
  return "";
}

/** Every markdown link target in a body. */
function linkTargets(body: string): string[] {
  return [...body.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1]!);
}

// ===========================================================================
// AC-STE-572.1 — the honored-contracts catalog carries an entry per gate
// ===========================================================================

/** The catalog's four load-bearing labels, verbatim from the existing entries. */
const CONTRACT_LABELS = [
  "**Mandate.**",
  "**Violation name.**",
  "**Auditable evidence.**",
  "**Precedent FRs.**",
] as const;

/**
 * The catalog section that documents one gate, or null.
 *
 * Sliced per-`##`-section rather than by substring over the whole file, so a
 * gate mentioned in passing inside a NEIGHBOURING entry cannot stand in for an
 * entry of its own — and so the four labels an entry is graded on are that
 * entry's labels and not the ones above it.
 */
function contractEntry(body: string, gateName: string): string | null {
  const parts = body.split(/^## /m);
  for (let i = 1; i < parts.length; i++) {
    const whole = `## ${parts[i]!}`;
    if (whole.includes(gateName)) return whole;
  }
  return null;
}

/** AC.1 — the catalog documents one gate in the four-label shape. */
function contractsDocumentGate(body: string, gate: BlockingGate): boolean {
  const entry = contractEntry(body, gate.name);
  if (entry === null) return false;
  if (!CONTRACT_LABELS.every((l) => entry.includes(l))) return false;
  if (!entry.includes(gate.skill)) return false;
  return PRECEDENT_FRS.some((fr) => entry.includes(fr));
}

/** AC.1 — every derived gate, so documenting all but one is false. */
const contractsDocumentEveryGate = (body: string): boolean =>
  GATES.length === DERIVED_GATES.length &&
  GATES.every((g) => contractsDocumentGate(body, g));

// ===========================================================================
// AC-STE-572.2 — the manual links BACK at the surfaces that cite it
// ===========================================================================

/** The manual's `## Related references` section, or "". */
const relatedReferences = (body: string): string =>
  section(body, (h) => /^related references$/i.test(h));

/** AC.2 — the back-link section names one citing surface. */
function manualLinksBackTo(body: string, surface: string): boolean {
  return relatedReferences(body).includes(surface);
}

/**
 * The surfaces that cite the manual and must be cited back, so the link is
 * bidirectional rather than a one-way pointer only the manual knows about.
 */
const CITING_SURFACES = ["CLAUDE.md.template", "workflow-overview.md"] as const;

const manualLinksBackToEverySurface = (body: string): boolean =>
  CITING_SURFACES.every((s) => manualLinksBackTo(body, s));

// ===========================================================================
// AC-STE-572.3 — both repository-structure trees name the blocking hooks
// ===========================================================================

/**
 * The `hooks/` entry of a repository-structure tree, plus any wrapped
 * continuation lines that belong to it (a tree entry ends where the next
 * `──` connector begins).
 */
function hooksTreeEntry(body: string): string {
  const lines = body.split("\n");
  const i = lines.findIndex((l) => l.includes("hooks/") && l.includes("hooks.json"));
  if (i === -1) return "";
  const out = [lines[i]!];
  for (let j = i + 1; j < lines.length; j++) {
    const l = lines[j]!;
    if (l.includes("──") || l.startsWith("```") || l.trim() === "") break;
    out.push(l);
  }
  return out.join("\n");
}

/** AC.3 — the tree entry names one blocking gate, as a blocking PreToolUse hook. */
function treeNamesGate(body: string, gate: BlockingGate): boolean {
  const entry = hooksTreeEntry(body);
  if (entry === "") return false;
  if (!/PreToolUse/.test(entry)) return false;
  if (!/block/i.test(entry)) return false;
  return entry.includes(gate.name);
}

const treeNamesEveryGate = (body: string): boolean =>
  GATES.every((g) => treeNamesGate(body, g));

// ===========================================================================
// AC-STE-572.4 — the README documentation index lists both documents
// ===========================================================================

/** The README's `## Documentation` section, or "". */
const documentationIndex = (body: string): string =>
  section(body, (h) => /^documentation$/i.test(h));

/** AC.4 — the index carries a markdown link whose target ends in `path`. */
function indexLinksTo(body: string, path: string): boolean {
  return linkTargets(documentationIndex(body)).some((t) => t.endsWith(path));
}

const indexListsBothDocs = (body: string): boolean =>
  indexLinksTo(body, MANUAL_REL) && indexLinksTo(body, CONTRACTS_REL);

// ===========================================================================
// AC-STE-572.5 — the workflow map names the gates in PROSE, not only in a row
// ===========================================================================

/**
 * The body with every markdown table row removed.
 *
 * This is the whole point of AC.5. A naive whole-file grep passes today on one
 * row two thirds down a sixty-seven-row table — the control leg below measures
 * exactly that — so the reader that grades the AC has to be blind to tables.
 */
function withoutTableRows(body: string): string {
  return body
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("|"))
    .join("\n");
}

/** AC.5 — the lifecycle prose names one gate outside the tables. */
function proseNamesGate(body: string, gate: BlockingGate): boolean {
  return withoutTableRows(body).includes(gate.name);
}

const proseNamesEveryGate = (body: string): boolean =>
  GATES.every((g) => proseNamesGate(body, g));

/** The distinctive text of the buried row, used by the control leg. */
const BURIED_ROW_TEXT = "harness PreToolUse (exit 2)";

// ===========================================================================
// AC-STE-572.6 — both skills say it at the point of use
// ===========================================================================

/** The blank-line-separated block of a body that names `needle`, or "". */
function blockNaming(body: string, needle: string): string {
  const blocks = body.split(/\n[ \t]*\n/);
  return blocks.find((b) => b.includes(needle)) ?? "";
}

/**
 * AC.6 — at the point of use, the skill says the Skill invocation itself is the
 * token the hook reads, and that running the gate commands by hand does not
 * clear it.
 *
 * Graded on the BLOCK that names the hook rather than on the whole file:
 * `skills/gate-check/SKILL.md` already contains the phrase "by hand" 200-odd
 * lines away, about a different subject entirely, and a whole-file grep would
 * count that as the statement this AC asks for.
 */
function statesPointOfUse(body: string, gate: BlockingGate): boolean {
  const block = blockNaming(body, gate.name);
  if (block === "") return false;
  if (!block.includes(gate.skill)) return false;
  if (!block.includes("tool_use")) return false;
  return /by hand|manually/i.test(block);
}

/** The cap, read by NAME out of the length-cap test rather than restated. */
function skillLineCap(): number {
  const src = read(CAP_TEST_PATH);
  const m = /const SKILL_LINE_CAP\s*=\s*(\d+)/.exec(src);
  if (m === null) throw new Error("SKILL_LINE_CAP not found in skill-nfr-1-length.test.ts");
  return Number.parseInt(m[1]!, 10);
}

/** The same counter the cap test uses — `wc -l` reports one less at the boundary. */
const lineCount = (body: string): number => body.split("\n").length;

// ===========================================================================
// The agreement leg — the hand-kept `GATES` and the gates the entry points
// themselves declare must name the same set.
//
// Compared as SORTED collections, never positionally: `DERIVED_GATES` arrives
// name-sorted while `GATES` keeps the order the point-of-use rows below bind by
// index, so an index-by-index comparison would red on a perfectly healthy tree.
// Skills are graded alongside names, because a gate that kept its name and
// changed the Skill it demands is a changed promise a name-only check misses.
// ===========================================================================

describe("the hand-kept list agrees with the derived gates", () => {
  test("GATES and DERIVED_GATES name the same gates and demand the same skills", () => {
    const openThis =
      "the blocking gates are read from the entry points under " +
      "templates/hooks/_lib/hooks — open that tree, then reconcile GATES above";

    // An unreadable or absent hook tree derives to `[]`, and `[].sort()` equals
    // `[].sort()`: the comparison below would pass while grading nothing. This
    // is the guard that makes the agreement mean something.
    expect(
      DERIVED_GATES.length,
      "no blocking gate was derived at all — " + openThis,
    ).toBeGreaterThan(0);

    expect([...GATES].map((g) => g.name).sort(), openThis).toEqual(
      DERIVED_GATES.map((g) => g.hook).sort(),
    );
    expect([...GATES].map((g) => `${g.name} → ${g.skill}`).sort(), openThis).toEqual(
      DERIVED_GATES.map((g) => `${g.hook} → ${g.skill}`).sort(),
    );
  });
});

// ===========================================================================
// Zero-hit guards — every reader above is pointed at a real, non-trivial
// surface, and each one is exercised on something the FR does not touch, so a
// silently-empty extraction fails loudly here instead of quietly satisfying an
// `every()` further down.
// ===========================================================================

describe("the readers are pointed at the surfaces this FR governs", () => {
  test("all seven subject files are real and non-trivial", () => {
    for (const [label, body] of [
      ["README.md", readme()],
      ["CLAUDE.md", rootClaude()],
      ["honored-contracts.md", contracts()],
      ["hooks-reference.md", manual()],
      ["workflow-overview.md", workflow()],
      ["pr/SKILL.md", read(PR_SKILL_PATH)],
      ["gate-check/SKILL.md", read(GATE_SKILL_PATH)],
    ] as const) {
      expect(body.length, label).toBeGreaterThan(500);
    }
  });

  test("the section reader finds a section that predates this FR", () => {
    // `/implement → /tdd` is the catalog's first entry and this FR does not
    // touch it, so this guard survives the edit that greens the AC.1 legs.
    const entry = contractEntry(contracts(), "/implement → /tdd");
    expect(entry, "the catalog's existing first entry is unreachable").not.toBeNull();
    for (const label of CONTRACT_LABELS) expect(entry!).toContain(label);
  });

  test("the `## Related references` section of the manual is reachable", () => {
    const refs = relatedReferences(manual());
    expect(refs, "no `## Related references` section in the hooks manual").not.toBe("");
    // Existing back-links, untouched by this FR.
    expect(refs).toContain("hooks/hooks.json");
    expect(refs).toContain(CONTRACTS_REL);
  });

  test("the hooks tree entry is reachable in BOTH root trees", () => {
    for (const [label, body] of [
      ["README.md", readme()],
      ["CLAUDE.md", rootClaude()],
    ] as const) {
      const entry = hooksTreeEntry(body);
      expect(entry, `${label}: no hooks/ tree entry found`).not.toBe("");
      expect(entry, `${label}: extracted the wrong line`).toContain("hooks.json");
      // The capture wiring these trees already describe.
      expect(entry, label).toContain("SessionEnd");
      expect(entry, label).toContain("Stop");
    }
  });

  test("the README documentation index is reachable and already has links", () => {
    const index = documentationIndex(readme());
    expect(index, "no `## Documentation` section in README.md").not.toBe("");
    expect(linkTargets(index).length).toBeGreaterThanOrEqual(5);
    expect(indexLinksTo(readme(), "docs/sdd-methodology.md")).toBe(true);
  });

  test("the block reader isolates a block, not the whole file", () => {
    const block = blockNaming(read(GATE_SKILL_PATH), "Tracker Mode Probe");
    expect(block).not.toBe("");
    expect(block.length).toBeLessThan(read(GATE_SKILL_PATH).length);
  });

  test("the cap is read from the length-cap test by name, not restated", () => {
    const cap = skillLineCap();
    expect(cap).toBeGreaterThan(300);
    expect(read(CAP_TEST_PATH)).toContain(`SKILL_LINE_CAP = ${cap}`);
  });
});

// ===========================================================================
// AC-STE-572.1 — honored-contracts gains one entry per blocking gate
// ===========================================================================

describe("AC-STE-572.1 — the catalog carries an entry per blocking gate", () => {
  // Three separate cases, per the AC: naming two of three is a fail.
  for (const gate of GATES) {
    test(`${gate.name} has a four-label catalog entry naming its skill + precedent`, () => {
      const entry = contractEntry(contracts(), gate.name);
      expect(entry, `${gate.name} has no catalog entry`).not.toBeNull();
      for (const label of CONTRACT_LABELS) {
        expect(entry!, `${gate.name} entry omits ${label}`).toContain(label);
      }
      expect(entry!, `${gate.name} entry omits its required skill`).toContain(gate.skill);
      expect(
        PRECEDENT_FRS.some((fr) => entry!.includes(fr)),
        `${gate.name} entry names none of ${PRECEDENT_FRS.join(", ")}`,
      ).toBe(true);
      expect(contractsDocumentGate(contracts(), gate)).toBe(true);
    });
  }

  test("all three together", () => {
    expect(contractsDocumentEveryGate(contracts())).toBe(true);
  });
});

// ===========================================================================
// AC-STE-572.2 — the manual's back-links make the pointer bidirectional
// ===========================================================================

describe("AC-STE-572.2 — `## Related references` cites the surfaces that cite it", () => {
  for (const surface of CITING_SURFACES) {
    test(`the manual links back to ${surface}`, () => {
      expect(
        manualLinksBackTo(manual(), surface),
        `\`## Related references\` never names ${surface}`,
      ).toBe(true);
    });
  }

  test("both together", () => {
    expect(manualLinksBackToEverySurface(manual())).toBe(true);
  });
});

// ===========================================================================
// AC-STE-572.3 — both root trees name the blocking PreToolUse hooks
// ===========================================================================

describe("AC-STE-572.3 — the two repository-structure trees name the gates", () => {
  for (const [label, body] of [
    ["README.md", () => readme()],
    ["CLAUDE.md", () => rootClaude()],
  ] as const) {
    test(`${label}: the hooks entry says the hooks BLOCK, via PreToolUse`, () => {
      const entry = hooksTreeEntry(body());
      expect(entry, `${label}: no hooks entry`).not.toBe("");
      expect(entry, `${label}: describes only the capture wiring`).toMatch(/PreToolUse/);
      expect(entry, `${label}: never says the hooks block`).toMatch(/block/i);
    });

    // Per file AND per gate: naming two of three in one tree is a fail.
    for (const gate of GATES) {
      test(`${label}: the hooks entry names ${gate.name}`, () => {
        expect(treeNamesGate(body(), gate)).toBe(true);
      });
    }

    test(`${label}: all three together`, () => {
      expect(treeNamesEveryGate(body())).toBe(true);
    });
  }
});

// ===========================================================================
// AC-STE-572.4 — the README documentation index lists both documents
// ===========================================================================

describe("AC-STE-572.4 — the documentation index lists the manual + the catalog", () => {
  test(`the index links to ${MANUAL_REL}`, () => {
    expect(indexLinksTo(readme(), MANUAL_REL)).toBe(true);
  });

  test(`the index links to ${CONTRACTS_REL}`, () => {
    expect(indexLinksTo(readme(), CONTRACTS_REL)).toBe(true);
  });

  test("both together", () => {
    expect(indexListsBothDocs(readme())).toBe(true);
  });
});

// ===========================================================================
// AC-STE-572.5 — the workflow map names the gates in its lifecycle PROSE
// ===========================================================================

describe("AC-STE-572.5 — the gates are named outside the sixty-seven-row table", () => {
  test("CONTROL — the naive whole-file grep already passes on the buried row", () => {
    // Measured, not asserted from memory: today the only thing in this file
    // that mentions the blocking layer is one table row. A whole-file reader
    // therefore reports the AC satisfied on the tree this FR exists to fix,
    // which is exactly why the reader below strips tables.
    const body = workflow();
    expect(body, "the buried row moved — re-measure the control").toContain(
      BURIED_ROW_TEXT,
    );
    expect(
      withoutTableRows(body),
      "the table stripper did not strip the buried row",
    ).not.toContain(BURIED_ROW_TEXT);
  });

  test("the table stripper removes rows and keeps prose", () => {
    const stripped = withoutTableRows(workflow());
    expect(stripped).toContain("# Toolkit Workflow Map");
    expect(stripped.length).toBeLessThan(workflow().length);
  });

  // Three separate cases, per the AC.
  for (const gate of GATES) {
    test(`the lifecycle prose names ${gate.name}`, () => {
      expect(
        proseNamesGate(workflow(), gate),
        `${gate.name} appears only inside a table, or not at all`,
      ).toBe(true);
    });
  }

  test("all three together", () => {
    expect(proseNamesEveryGate(workflow())).toBe(true);
  });
});

// ===========================================================================
// AC-STE-572.6 — the two skills say it at the point of use, under the cap
// ===========================================================================

describe("AC-STE-572.6 — /pr and /gate-check state the contract at the point of use", () => {
  const POINT_OF_USE = [
    { path: PR_SKILL_PATH, label: "skills/pr/SKILL.md", gate: GATES[1]! },
    { path: GATE_SKILL_PATH, label: "skills/gate-check/SKILL.md", gate: GATES[0]! },
  ] as const;

  for (const { path, label, gate } of POINT_OF_USE) {
    test(`${label} says the Skill invocation is the token, and by-hand does not clear it`, () => {
      const body = read(path);
      const block = blockNaming(body, gate.name);
      expect(block, `${label} never names ${gate.name}`).not.toBe("");
      expect(block, `${label}: the block omits the required skill`).toContain(gate.skill);
      expect(block, `${label}: the block never says the token is a tool_use`).toContain(
        "tool_use",
      );
      expect(block, `${label}: the block never rules out running it by hand`).toMatch(
        /by hand|manually/i,
      );
      expect(statesPointOfUse(body, gate)).toBe(true);
    });

    test(`${label} is still at or under the cap read from the length-cap test`, () => {
      // The cap is READ BY NAME. A shipped test in this repository was once
      // found pinning a value one off from the cap it named.
      expect(lineCount(read(path)), label).toBeLessThanOrEqual(skillLineCap());
    });
  }
});

// ===========================================================================
// AC-STE-572.7 — no added line steals a counted token
//
// This leg is a CONTROL: it passes on the landed tree, because nothing has
// drifted yet. Its job is to red if the edits that green AC.3 and AC.4 add a
// line that the first-match-wins count parser picks up instead.
// ===========================================================================

describe("AC-STE-572.7 — the public-surface counts are untouched", () => {
  test("publicSurfaceCountDrift reports no violation over the edited roots", async () => {
    const report = await runPublicSurfaceCountDriftProbe(repoRoot);
    expect(report.violations).toEqual([]);
  });

  test("the tokens the probe parses are the ones it parsed before this FR", () => {
    // The probe exposes only `violations`, so the parsed values are pinned here
    // with the probe's own readers: README line 3, and the FIRST content match
    // in CLAUDE.md.
    const readmeL3 = readme().split("\n")[2]!;
    const l3 = /(\d+)\s+commands?,\s+(\d+)\s+agents?/.exec(readmeL3);
    expect(l3, "README line 3 no longer carries the count token").not.toBeNull();
    expect(l3![1]).toBe("18");
    expect(l3![2]).toBe("8");

    const claude = rootClaude();
    expect(/(\d+)\s+slash commands?/.exec(claude)![1]).toBe("27");
    expect(/(\d+)\s+subagent templates?/.exec(claude)![1]).toBe("8");
    const split = /\((\d+)\s+user-invocable\s*\+\s*(\d+)\s+dispatch/.exec(claude);
    expect(split, "the CLAUDE.md user-invocable/dispatch split token is gone").not.toBeNull();
    expect(split![1]).toBe("18");
    expect(split![2]).toBe("9");
  });

  test("no added line becomes a NEW first match for a counted token", () => {
    // First-match-wins by content scan: a second carrier of any of these
    // shapes can silently re-point the parser at prose this FR added.
    const claude = rootClaude();
    expect([...claude.matchAll(/\d+\s+slash commands?/g)]).toHaveLength(1);
    expect([...claude.matchAll(/\d+\s+subagent templates?/g)]).toHaveLength(1);

    const body = readme();
    expect([...body.matchAll(/\d+\s+commands?,\s+\d+\s+agents?/g)]).toHaveLength(1);
    expect([...body.matchAll(/\d+\s+(?:slash commands?|subagent templates?)/g)]).toHaveLength(
      0,
    );
  });
});

// ===========================================================================
// AC-STE-572.8 — falsifiability.
//
// AC.1 through AC.5, one mutation each (and then some). EVERY leg measures the
// landed tree clean FIRST and applies its mutation through the throwing
// `mutate` helper, so a regex that stopped matching raises instead of reading
// as a green test asserting that a guard it never removed still works.
// ===========================================================================

describe("AC-STE-572.8 — AC.1 through AC.5 are mutation-tested", () => {
  test("AC.1 — removing ONE gate's catalog entry reds only that gate", () => {
    const clean = contracts();
    expect(contractsDocumentEveryGate(clean)).toBe(true);

    for (const dropped of GATES) {
      // Global: an entry that names its hook twice (heading + evidence line)
      // would survive a first-occurrence mutation.
      const mutated = mutate(clean, new RegExp(dropped.name, "g"), "pre-removed-hook");
      expect(contractsDocumentGate(mutated, dropped), dropped.name).toBe(false);
      expect(contractsDocumentEveryGate(mutated), dropped.name).toBe(false);
      // Isolation: the other two survive, so the three legs above are three
      // assertions and not one.
      for (const kept of GATES.filter((g) => g.name !== dropped.name)) {
        expect(contractsDocumentGate(mutated, kept), kept.name).toBe(true);
      }
    }
  });

  test("AC.1 — dropping a LABEL from an entry reds it, not just the name", () => {
    const clean = contracts();
    const gate = GATES[0]!;
    expect(contractsDocumentGate(clean, gate)).toBe(true);
    const entry = contractEntry(clean, gate.name)!;
    const stripped = mutate(entry, "**Precedent FRs.**", "Precedent FRs:");
    const mutated = clean.replace(entry, stripped);
    expect(contractsDocumentGate(mutated, gate)).toBe(false);
  });

  test("AC.1 — dropping the PRECEDENT FRs from an entry reds it", () => {
    const clean = contracts();
    const gate = GATES[1]!;
    expect(contractsDocumentGate(clean, gate)).toBe(true);
    const entry = contractEntry(clean, gate.name)!;
    let stripped = entry;
    for (const fr of PRECEDENT_FRS) {
      if (stripped.includes(fr)) stripped = mutate(stripped, new RegExp(fr, "g"), "STE-000");
    }
    expect(stripped, "no precedent FR was actually removed").not.toBe(entry);
    const mutated = clean.replace(entry, stripped);
    expect(contractsDocumentGate(mutated, gate)).toBe(false);
  });

  test("AC.2 — removing a back-link reds only that surface", () => {
    const clean = manual();
    expect(manualLinksBackToEverySurface(clean)).toBe(true);

    for (const surface of CITING_SURFACES) {
      const mutated = mutate(clean, new RegExp(surface, "g"), "some-other-file.md");
      expect(manualLinksBackTo(mutated, surface), surface).toBe(false);
      expect(manualLinksBackToEverySurface(mutated), surface).toBe(false);
      for (const kept of CITING_SURFACES.filter((s) => s !== surface)) {
        expect(manualLinksBackTo(mutated, kept), kept).toBe(true);
      }
    }
  });

  test("AC.3 — dropping one gate from EITHER tree reds that file", () => {
    for (const [label, clean] of [
      ["README.md", readme()],
      ["CLAUDE.md", rootClaude()],
    ] as const) {
      expect(treeNamesEveryGate(clean), label).toBe(true);
      for (const dropped of GATES) {
        const mutated = mutate(clean, new RegExp(dropped.name, "g"), "pre-removed-hook");
        expect(treeNamesGate(mutated, dropped), `${label} / ${dropped.name}`).toBe(false);
        expect(treeNamesEveryGate(mutated), `${label} / ${dropped.name}`).toBe(false);
        for (const kept of GATES.filter((g) => g.name !== dropped.name)) {
          expect(treeNamesGate(mutated, kept), `${label} / kept ${kept.name}`).toBe(true);
        }
      }
    }
  });

  test("AC.3 — reverting a tree entry to capture-only prose reds it", () => {
    // The precise pre-FR defect: an entry that names SessionEnd and Stop and
    // nothing else. If this passed, the AC.3 legs would not be about blocking.
    for (const [label, clean] of [
      ["README.md", readme()],
      ["CLAUDE.md", rootClaude()],
    ] as const) {
      expect(treeNamesEveryGate(clean), label).toBe(true);
      const entry = hooksTreeEntry(clean);
      const reverted = clean.replace(
        entry,
        mutate(entry, /PreToolUse/g, "capture-only"),
      );
      expect(treeNamesEveryGate(reverted), label).toBe(false);
    }
  });

  test("AC.4 — removing either index link reds only that link", () => {
    const clean = readme();
    expect(indexListsBothDocs(clean)).toBe(true);
    for (const [target, other] of [
      [MANUAL_REL, CONTRACTS_REL],
      [CONTRACTS_REL, MANUAL_REL],
    ] as const) {
      const index = documentationIndex(clean);
      const line = index
        .split("\n")
        .find((l) => l.includes(target) && /\[[^\]]*\]\([^)]*\)/.test(l));
      expect(line, `no index line links to ${target}`).toBeDefined();
      const mutated = mutate(clean, line!, "");
      expect(indexLinksTo(mutated, target), target).toBe(false);
      expect(indexListsBothDocs(mutated), target).toBe(false);
      expect(indexLinksTo(mutated, other), other).toBe(true);
    }
  });

  test("AC.5 — a gate named ONLY in a table row reds the prose reader", () => {
    const clean = workflow();
    expect(proseNamesEveryGate(clean)).toBe(true);

    for (const dropped of GATES) {
      // Delete every PROSE line that names the gate; the table rows (if any)
      // are left standing, so what this measures is precisely "documented only
      // in the table" — the state the AC exists to reject.
      const proseLines = clean
        .split("\n")
        .filter((l) => l.includes(dropped.name) && !l.trimStart().startsWith("|"));
      expect(proseLines.length, `${dropped.name} has no prose line to remove`).toBeGreaterThan(
        0,
      );
      let mutated = clean;
      for (const line of proseLines) mutated = mutate(mutated, line, "");
      expect(proseNamesGate(mutated, dropped), dropped.name).toBe(false);
      expect(proseNamesEveryGate(mutated), dropped.name).toBe(false);
      for (const kept of GATES.filter((g) => g.name !== dropped.name)) {
        if (kept.name.includes(dropped.name) || dropped.name.includes(kept.name)) continue;
        expect(proseNamesGate(mutated, kept), `kept ${kept.name}`).toBe(true);
      }
    }
  });

  test("the mutation helper itself refuses a mutation that never applied", () => {
    // The guard that stops every leg above from passing vacuously.
    expect(() => mutate(contracts(), /this string is not in the catalog/, "x")).toThrow(
      /mutation did not apply/,
    );
  });
});
