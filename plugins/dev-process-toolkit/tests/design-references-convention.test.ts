import { describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// STE-341 — specs/design/ storage convention + optional `## Design References`
// template section. This FR is a DOCUMENTATION / PROSE-CONTRACT only — no
// runtime helper ships. These meta-tests assert the documentation + skill
// surfaces carry the convention (modelled on the existing
// `*-doc-conformance` / `claude-md-template-docs-stub` meta-tests:
// readFileSync the surface, assert it contains the required phrasing).

const pluginRoot = join(import.meta.dir, "..");

const layoutPath = join(pluginRoot, "docs", "layout-reference.md");
const specWritePath = join(pluginRoot, "skills", "spec-write", "SKILL.md");
const implementPath = join(pluginRoot, "skills", "implement", "SKILL.md");
const specArchivePath = join(pluginRoot, "skills", "spec-archive", "SKILL.md");
const templatePath = join(pluginRoot, "templates", "CLAUDE.md.template");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

/**
 * Slice § 0b (FR creation path) out of /spec-write SKILL.md so placement
 * assertions are scoped to the body-section contract, not the whole file.
 */
function specWriteSection0b(body: string): string {
  const start = body.indexOf("### 0b. FR creation path");
  const end = body.indexOf("### 1. Assess current state");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return body.slice(start, end);
}

describe("STE-341 — specs/design/ convention + optional ## Design References section", () => {
  test("AC-STE-341.1 — layout-reference.md documents both specs/design/ subtrees + never-archived rule", () => {
    const layout = read(layoutPath);

    // Both subtrees must be documented by their canonical paths.
    expect(layout).toContain("specs/design/system/");
    expect(layout).toContain("specs/design/frs/");

    // The never-archived rule: no skill git-mv's or rewriteArchiveLinks-
    // rewrites any specs/design/ path. Accept "never archived"/"never-
    // archived" or "never `git mv`" / "never ... rewriteArchiveLinks".
    expect(layout).toMatch(
      /never[- ]archived|never\b[\s\S]{0,20}git mv|never\b[\s\S]{0,24}rewriteArchiveLinks/i,
    );
  });

  test("AC-STE-341.2 — optional `## Design References` section documented (shape + worked example)", () => {
    // (a) layout-reference.md names the section AND relaxes the
    // "exactly these top-level sections" closed-set claim to admit the
    // optional follow-on.
    const layout = read(layoutPath);
    expect(layout).toContain("## Design References");
    expect(layout).toMatch(
      /optional(?:ly)?[\s\S]{0,140}Design References|Design References[\s\S]{0,140}optional(?:ly)?/i,
    );

    // (b) /spec-write § 0b body-section contract documents the optional
    // section placed after `## Acceptance Criteria`, with repo-root-relative
    // image paths and a worked example.
    const sec0b = specWriteSection0b(read(specWritePath));
    expect(sec0b).toContain("## Design References");
    expect(sec0b).toContain("## Acceptance Criteria");
    // Placement: the optional section is introduced after the required
    // `## Acceptance Criteria` section in the contract prose.
    expect(sec0b.indexOf("## Design References")).toBeGreaterThan(
      sec0b.indexOf("## Acceptance Criteria"),
    );
    // Reference style is documented as repo-root-relative.
    expect(sec0b).toMatch(/repo[- ]root[- ]relative/i);
    // Worked example: a repo-root-relative design-image path.
    expect(sec0b).toMatch(
      /specs\/design\/frs\/[^\s)`'"]+\.(?:png|jpe?g|svg|webp|gif)/i,
    );
  });

  test("AC-STE-341.3 — archival immutability stated at /implement Phase 4 + /spec-archive", () => {
    // Each archival surface carries an explicit specs/design/ immutability
    // statement: specs/design/ paths are never git-mv'd and never rewritten
    // by rewriteArchiveLinks. Check it as a co-located statement (the
    // never/immutable wording + the rewrite mechanism appear in the same
    // neighborhood as the specs/design/ mention).
    const assertImmutabilityStatement = (path: string) => {
      const body = read(path);
      const idx = body.indexOf("specs/design/");
      expect(idx, `${path} should mention specs/design/`).toBeGreaterThan(-1);
      const window = body.slice(Math.max(0, idx - 200), idx + 400);
      expect(window, `${path}: immutability wording near specs/design/`).toMatch(
        /never|immutab/i,
      );
      expect(
        window,
        `${path}: git mv / rewriteArchiveLinks near specs/design/`,
      ).toMatch(/git mv|rewriteArchiveLinks/);
    };

    assertImmutabilityStatement(implementPath);
    assertImmutabilityStatement(specArchivePath);
  });

  test("AC-STE-341.4 — FR-section contract carries the optional-section permission note (no drift)", () => {
    // No /gate-check probe enforces the FR body section SET/ORDER, so the
    // no-drift requirement is satisfied by an explicit note in the FR-section
    // contract that the optional `## Design References` section is permitted
    // after `## Acceptance Criteria`. Kept distinct from .2: this is the
    // permission / no-drift wording specifically.
    const layout = read(layoutPath);
    expect(layout).toMatch(
      /optional(?:ly)?\s+followed by[\s\S]{0,40}Design References|optional(?:ly)?[\s\S]{0,100}Design References[\s\S]{0,100}Acceptance Criteria/i,
    );
  });

  test("AC-STE-341.1 (template) — CLAUDE.md.template mentions specs/design/", () => {
    // Generated projects learn the convention exists via the layout overview.
    const template = read(templatePath);
    expect(template).toContain("specs/design/");
  });
});

// ---------------------------------------------------------------------------
// STE-596 — the consuming half of the design-reference capability: Phase 4b″
// hands the in-scope FR's references to the resolved check skill, through the
// one shared renderer, on BOTH the auto-run path and the `manual` reminder
// path. These are prose-contract meta-tests over the same surfaces the STE-341
// legs above grade, plus the capability-key registry and the two archived FRs
// whose lineage claim this milestone corrects.
//
// NOTE for whoever lands the prose: AC-STE-341.3 above windows around the
// FIRST `specs/design/` occurrence in skills/implement/SKILL.md, which today
// sits in § Milestone Archival — BELOW Phase 4b″. Writing a literal
// `specs/design/` into the Phase 4b″ section moves that window onto prose that
// carries no immutability wording and reds a guard that is not this
// milestone's subject. Name the renderer and the scanner, not the tree.
// ---------------------------------------------------------------------------

const PHASE_4B_DOUBLE_PRIME_HEADING = "### Phase 4b″ — Project Verification";

/** Slice the Phase 4b″ section out of /implement SKILL.md. */
function phase4bDoublePrimeSection(body: string): string {
  const start = body.indexOf(PHASE_4B_DOUBLE_PRIME_HEADING);
  const end = body.indexOf("### Commit message format");
  expect(start, "Phase 4b″ section heading not found").toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return body.slice(start, end);
}

/** Paragraphs of a markdown slice (blank-line separated). */
function paragraphs(slice: string): string[] {
  return slice.split(/\n\s*\n/);
}

/**
 * Assert that ONE paragraph carries every needle. Co-location matters here:
 * "the renderer is named somewhere in the section" and "the manual reminder
 * renders the same block" are different claims, and a whole-section
 * `toContain` cannot tell them apart.
 *
 * WHY THIS IS NOT ENOUGH ON ITS OWN, and what `expectWithinWindow` below is
 * for. This helper's premise is that a paragraph is a claim. In Phase 4b″ the
 * whole run-placement discussion is ONE markdown paragraph, so for that section
 * the split degrades to a section-wide `includes` and every needle already
 * present elsewhere in the paragraph comes for free. The AC.6 legs were
 * measured passing that way — with the capability sentence deleted, both went
 * on passing, because `manual`, `reminder` and `auto-run` all pre-date this FR
 * and the one new needle was supplied by AC.1's sentence. A grader that cannot
 * fail when its subject is removed grades nothing.
 */
function expectCoLocated(
  slice: string,
  label: string,
  needles: readonly (string | RegExp)[],
): void {
  const hit = paragraphs(slice).some((p) =>
    needles.every((n) => (typeof n === "string" ? p.includes(n) : n.test(p))),
  );
  expect(hit, `${label}: no single paragraph carries ${needles.map(String).join(" + ")}`).toBe(
    true,
  );
}

/** Radius, in characters, of the co-location window. Wide enough for one
 * sentence of this file's house prose, far narrower than its paragraphs. */
const WINDOW_RADIUS = 420;

/**
 * Assert every needle appears inside ONE window of `2 * WINDOW_RADIUS`
 * characters, anchored at each occurrence of the first needle.
 *
 * Structure-free on purpose: it does not care whether the author wrote one
 * paragraph or six, so it cannot be satisfied by a needle that merely shares a
 * paragraph with the claim. The anchor is the claim's own subject, so deleting
 * the sentence that makes the claim removes the anchor and the assertion fails
 * — which is the property `expectCoLocated` lost in this section.
 */
function expectWithinWindow(
  slice: string,
  label: string,
  anchor: string | RegExp,
  needles: readonly (string | RegExp)[],
): void {
  const anchors: number[] = [];
  if (typeof anchor === "string") {
    for (let i = slice.indexOf(anchor); i !== -1; i = slice.indexOf(anchor, i + 1)) {
      anchors.push(i);
    }
  } else {
    const re = new RegExp(anchor.source, anchor.flags.includes("g") ? anchor.flags : `${anchor.flags}g`);
    for (let m = re.exec(slice); m !== null; m = re.exec(slice)) {
      anchors.push(m.index);
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  expect(
    anchors.length,
    `${label}: the anchor ${String(anchor)} appears nowhere in the section`,
  ).toBeGreaterThan(0);

  const hit = anchors.some((i) => {
    const window = slice.slice(Math.max(0, i - WINDOW_RADIUS), i + WINDOW_RADIUS);
    return needles.every((n) => (typeof n === "string" ? window.includes(n) : n.test(window)));
  });
  expect(
    hit,
    `${label}: no ${2 * WINDOW_RADIUS}-char window around ${String(anchor)} carries ${needles
      .map(String)
      .join(" + ")}`,
  ).toBe(true);
}

describe("AC-STE-596.1 — Phase 4b″ passes the in-scope FR's design references", () => {
  const slice = phase4bDoublePrimeSection(read(implementPath));

  test("the section names the shared renderer and the FR-scoped row source", () => {
    // Booleans, not the slice itself — a failed `toContain` on a 12 KB
    // section prints the whole section and buries what is missing.
    expect(
      slice.includes("renderDesignReferenceBlock"),
      "Phase 4b″ does not name `renderDesignReferenceBlock`",
    ).toBe(true);
    expect(
      slice.includes("designReferencesForSpec"),
      "Phase 4b″ does not name `designReferencesForSpec`",
    ).toBe(true);
  });

  test("the rendered block is threaded into the resolved check skill's invocation", () => {
    expectWithinWindow(slice, "invocation", "renderDesignReferenceBlock", [
      /invocat|invoke|pass(?:es|ed)?\b/i,
      /check skill/i,
    ]);
  });

  test("each row is described as a repo-root-relative path plus the authored caption", () => {
    expectCoLocated(slice, "row shape", [
      /repo[- ]root[- ]relative/i,
      /caption/i,
    ]);
  });

  test("an FR citing zero references is vacuous — the invocation is byte-identical to today", () => {
    expectWithinWindow(
      slice,
      "vacuous path",
      /zero design references|cit(?:es|ing) (?:no|none)/i,
      [/byte[- ]identical|unchanged/i],
    );
  });
});

describe("AC-STE-596.5 — an unresolved image is skipped, never a Phase 4b″ failure", () => {
  const slice = phase4bDoublePrimeSection(read(implementPath));

  test("the section states the skip and refuses to fail the phase on it", () => {
    expectWithinWindow(slice, "unresolved skip", /unresolved/i, [
      /skip/i,
      /never fail|does not fail|not a failure|never block/i,
    ]);
  });

  test("it names the gate that already owns the condition at error severity", () => {
    expect(
      /design_references_resolve|probe #61/.test(slice),
      "Phase 4b″ does not name the gate (`design_references_resolve` / probe #61) that already fails an unresolved image",
    ).toBe(true);
  });
});

describe("AC-STE-596.6 — the manual path renders the SAME block in its reminder", () => {
  const slice = phase4bDoublePrimeSection(read(implementPath));

  test("the manual reminder renders the block through the same renderer", () => {
    // Anchored at the reminder claim, not at the paragraph: `manual`,
    // `reminder` and `auto-run` all pre-date this FR in this very paragraph,
    // so a paragraph-scoped assertion here passes with the claim deleted.
    expectWithinWindow(slice, "manual reminder", /`manual` reminder|reminder path/i, [
      "renderDesignReferenceBlock",
      /manual/i,
      /remind/i,
    ]);
  });

  test("the capability is stated as NOT restricted to auto-running projects", () => {
    // This repo itself declares `verify_mode: manual`, so the reminder path is
    // the one its own Phase 4b″ takes. Left implicit, the manual path is the
    // quiet half — shipped-looking and untested. The prose says so out loud.
    expectWithinWindow(
      slice,
      "not auto-run-only",
      /not restricted|not limited|regardless of|both paths/i,
      ["renderDesignReferenceBlock", /auto-run/i, /manual/i],
    );
  });
});

describe("AC-STE-596.7 — the capability token pair is registered in both directions", () => {
  const repoRoot = join(pluginRoot, "..", "..");

  test("both tokens are in CANONICAL_CAPABILITY_KEYS and routed by KEY_OWNER_SKILL", async () => {
    const { DESIGN_REFERENCE_CAPABILITY_TOKENS } = await loadBlockTokens();
    const { CANONICAL_CAPABILITY_KEYS, KEY_OWNER_SKILL } = await import(
      "../adapters/_shared/src/closing_summary_capability_keys"
    );
    const { passed, none } = DESIGN_REFERENCE_CAPABILITY_TOKENS;

    // The names stay anchored to what they describe — a token pair nobody can
    // recognise in a closing summary is a token pair nobody reads.
    expect(passed).toMatch(/design_references/);
    expect(none).toMatch(/design_references/);

    expect(CANONICAL_CAPABILITY_KEYS as readonly string[]).toContain(passed);
    expect(CANONICAL_CAPABILITY_KEYS as readonly string[]).toContain(none);
    expect((KEY_OWNER_SKILL as Record<string, string>)[passed]).toBe("spec-write");
    expect((KEY_OWNER_SKILL as Record<string, string>)[none]).toBe("spec-write");
  });

  test("/spec-write § 7's static map carries a MUST-emit directive and a rendered-prose row for each", async () => {
    const { DESIGN_REFERENCE_CAPABILITY_TOKENS } = await loadBlockTokens();
    const { passed, none } = DESIGN_REFERENCE_CAPABILITY_TOKENS;
    const specWrite = read(specWritePath);

    expect(specWrite).toContain(`MUST emit \`${passed}\``);
    expect(specWrite).toContain(`MUST emit \`${none}\``);

    // The static plain-language map is the canonical owner surface — the row
    // is what a project owner actually reads, so it must exist, not just the
    // directive the probe greps.
    const mapStart = specWrite.indexOf("| Capability key | Rendered prose |");
    expect(mapStart, "§ 7 static map header not found").toBeGreaterThan(-1);
    const map = specWrite.slice(mapStart);
    expect(map).toContain(`\`${passed}\``);
    expect(map).toContain(`\`${none}\``);
  });

  test("/implement Phase 4b″ carries both emission-site directives and emits exactly one", async () => {
    const { DESIGN_REFERENCE_CAPABILITY_TOKENS } = await loadBlockTokens();
    const { passed, none } = DESIGN_REFERENCE_CAPABILITY_TOKENS;
    const slice = phase4bDoublePrimeSection(read(implementPath));

    expect(slice).toContain(`MUST emit \`${passed}\``);
    expect(slice).toContain(`MUST emit \`${none}\``);
    expectWithinWindow(slice, "exactly-one rule", /exactly one/i, [`\`${passed}\``]);
  });

  test("the closing_summary_capability_keys probe is GREEN on both keys, in both directions", async () => {
    const { DESIGN_REFERENCE_CAPABILITY_TOKENS } = await loadBlockTokens();
    const { runClosingSummaryCapabilityKeysProbe } = await import(
      "../adapters/_shared/src/closing_summary_capability_keys"
    );
    const { passed, none } = DESIGN_REFERENCE_CAPABILITY_TOKENS;

    const report = await runClosingSummaryCapabilityKeysProbe(repoRoot);
    const ours = report.violations.filter(
      (v) => v.missingKey === passed || v.missingKey === none,
    );
    expect(ours.map((v) => v.message)).toEqual([]);

    // POSITIVE CONTROL, because the line above is an absence assertion and the
    // FR's ## Testing section requires one beside every such leg. The probe is
    // VACUOUS when the owner SKILL.md is missing — it returns zero violations
    // for a tree that carries no directives at all — so a zero-violation read
    // on its own cannot tell "both keys are documented" from "the probe never
    // looked". Run it against a project whose spec-write body documents every
    // OTHER canonical key and neither of ours: it must name both, which is what
    // proves the green above was earned.
    const { CANONICAL_CAPABILITY_KEYS } = await import(
      "../adapters/_shared/src/closing_summary_capability_keys"
    );
    const control = mkdtempSync(join(tmpdir(), "design-refs-token-control-"));
    try {
      const dir = join(control, "plugins", "dev-process-toolkit", "skills", "spec-write");
      mkdirSync(dir, { recursive: true });
      const others = (CANONICAL_CAPABILITY_KEYS as readonly string[])
        .filter((k) => k !== passed && k !== none)
        .map((k) => `- MUST emit \`${k}\` at the documented site.`)
        .join("\n");
      writeFileSync(join(dir, "SKILL.md"), `# spec-write\n\n## 7\n\n${others}\n`);

      const controlReport = await runClosingSummaryCapabilityKeysProbe(control);
      expect(controlReport.violations.map((v) => v.missingKey).sort()).toEqual(
        [none, passed].sort(),
      );
    } finally {
      rmSync(control, { recursive: true, force: true });
    }
  });
});

describe("AC-STE-596.8 — the archived lineage claim is corrected in place", () => {
  const archiveDir = join(pluginRoot, "..", "..", "specs", "frs", "archive");

  test("STE-347's Lineage note states what M93 shipped, what STE-596 ships, and what stays the check skill's job", () => {
    const body = read(join(archiveDir, "STE-347.md"));
    const lineage = paragraphs(body).filter((p) => p.includes("**Lineage.**"));
    // Control: the paragraph this AC corrects exists at all.
    expect(lineage.length).toBe(1);
    const note = lineage[0]!;

    // What M93 actually shipped — the verification hook, not the consuming
    // half M91 deferred.
    expect(note).toMatch(/M93/);
    // …what closes the deferred half.
    expect(note).toContain("STE-596");
    // …and what remains out of scope for both: the app-driving visual
    // comparison is the project-authored check skill's own job.
    expect(note).toMatch(/visual/i);
    expect(note).toMatch(/project[- ]authored|check skill'?s? own/i);
  });

  test("STE-505, the Phase 4b″ argument-surface owner, is amended to match", () => {
    const body = read(join(archiveDir, "STE-505.md"));
    // Control: the FR whose argument surface this milestone widens is the one
    // being read (it owns the mandatory-drive rule).
    expect(body).toMatch(/run_cmd/);

    const amended = paragraphs(body).filter(
      (p) => p.includes("STE-596") && /design reference/i.test(p),
    );
    expect(
      amended.length,
      "no paragraph in archive/STE-505.md names STE-596 beside the design references its argument surface now carries",
    ).toBeGreaterThan(0);
  });
});

/**
 * Load the token pair from whichever shipped module owns the renderer — the
 * same discovery the unit suite uses, so the two graders cannot drift onto
 * different definitions of the pair.
 */
async function loadBlockTokens(): Promise<{
  DESIGN_REFERENCE_CAPABILITY_TOKENS: { passed: string; none: string };
}> {
  const srcDir = join(pluginRoot, "adapters", "_shared", "src");
  const hits: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "__tests__") continue;
        walk(path);
        continue;
      }
      if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue;
      if (/export\s+function\s+renderDesignReferenceBlock\b/.test(readFileSync(path, "utf8"))) {
        hits.push(path);
      }
    }
  };
  walk(srcDir);
  if (hits.length !== 1) {
    throw new Error(
      `expected exactly one shipped module exporting renderDesignReferenceBlock, found ${hits.length}`,
    );
  }
  return (await import(hits[0]!)) as never;
}
